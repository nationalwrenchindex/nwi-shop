// GET  /api/shop/jobs/[id]/line-items
// POST /api/shop/jobs/[id]/line-items
//
// POST body contract (this is the shape the inventory area posts to when it
// pushes a used part onto a job):
//
//   {
//     type:         'labor' | 'part'   // required
//     description:  string             // required unless inventory_id is given
//     part_number:  string | null      // optional
//     quantity:     number             // required, > 0
//     unit_cost:    number             // optional; see below
//     unit_price:   number             // optional, defaults from inventory or 0
//     inventory_id: string | null      // optional; when set, cost/description/
//                                      // part number default from that row
//     tech_id:      string | null      // optional; must belong to this shop
//   }
//
// `total` is always computed server-side as round2(quantity * unit_price) - a
// client-supplied total is ignored.
//
// `unit_cost` handling is a permission boundary, not a convenience:
//   - when `inventory_id` is given, cost is read from the inventory row and the
//     client value is ignored entirely;
//   - otherwise a client value is accepted only from a caller with
//     `viewMargins` (manager). A foreman posts sell price; cost stays 0.
// Responses strip `unit_cost` / margin fields for any caller without
// `viewMargins`.

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  apiError,
  asNumber,
  asText,
  readJsonBody,
  round2,
  summarizeLineItems,
  toLineItemView,
} from '@/lib/shop/jobs'
import type { LineItemType, ShopInventory, ShopJob, ShopJobLineItem } from '@/lib/types'

type Params = { params: Promise<{ id: string }> }

function asLineItemType(value: unknown): LineItemType | null {
  return value === 'labor' || value === 'part' ? value : null
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext()
  if (error) return error

  const { id } = await params
  const supabase = await createClient()

  const job = await findAccessibleJob(supabase, id, ctx.shop.id, {
    viewAllJobs: ctx.permissions.viewAllJobs,
    techId: ctx.tech.id,
  })
  if (!job) return apiError('Job not found.', 404)

  const { data } = await supabase
    .from('shop_job_line_items')
    .select('*')
    .eq('job_id', job.id)
    .eq('shop_id', ctx.shop.id)
    .order('created_at', { ascending: true })
    .returns<ShopJobLineItem[]>()

  const viewMargins = ctx.permissions.viewMargins
  const lineItems = (data ?? []).map((row) => toLineItemView(row, viewMargins))

  return Response.json({
    lineItems,
    totals: summarizeLineItems(lineItems, ctx.shop.tax_rate, viewMargins),
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext()
  if (error) return error

  const { id } = await params
  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const supabase = await createClient()

  // A tech may add to their own job (their labor); everyone else needs the
  // floor-manager permission.
  const job = await findAccessibleJob(supabase, id, ctx.shop.id, {
    viewAllJobs: ctx.permissions.viewAllJobs,
    techId: ctx.tech.id,
  })
  if (!job) return apiError('Job not found.', 404)
  if (job.voided) return apiError('This job has been voided.', 409)
  if (job.status === 'invoiced') return apiError('This job is already invoiced.', 409)

  const type = asLineItemType(body.type)
  if (!type) return apiError('`type` must be "labor" or "part".', 400)

  const quantity = asNumber(body.quantity)
  if (quantity === null || quantity <= 0) return apiError('`quantity` must be greater than 0.', 400)

  const inventoryId = asText(body.inventory_id)
  let description = asText(body.description)
  let partNumber = asText(body.part_number)
  let unitCost = 0
  let unitPrice = asNumber(body.unit_price)

  if (inventoryId) {
    const { data: part } = await supabase
      .from('shop_inventory')
      .select('*')
      .eq('id', inventoryId)
      .eq('shop_id', ctx.shop.id)
      .maybeSingle<ShopInventory>()
    if (!part) return apiError('Inventory item not found in this shop.', 404)

    // Cost always comes from the inventory row, never from the request.
    unitCost = Number(part.unit_cost) || 0
    description = description ?? part.description
    partNumber = partNumber ?? part.part_number
    if (unitPrice === null) unitPrice = Number(part.unit_price) || 0
  } else if (ctx.permissions.viewMargins) {
    unitCost = asNumber(body.unit_cost) ?? 0
  }

  if (!description) return apiError('`description` is required.', 400)
  if (unitPrice === null) {
    // Labor with no explicit price bills at the shop's labor rate.
    unitPrice = type === 'labor' ? Number(ctx.shop.labor_rate) || 0 : 0
  }
  if (unitPrice < 0 || unitCost < 0) return apiError('Prices cannot be negative.', 400)

  const techId = asText(body.tech_id)
  if (techId) {
    const { data: tech } = await supabase
      .from('shop_techs')
      .select('id')
      .eq('id', techId)
      .eq('shop_id', ctx.shop.id)
      .maybeSingle<{ id: string }>()
    if (!tech) return apiError('Tech not found in this shop.', 404)
  }

  const { data: created, error: insertError } = await supabase
    .from('shop_job_line_items')
    .insert({
      job_id:       job.id,
      shop_id:      ctx.shop.id,
      type,
      description,
      part_number:  partNumber,
      quantity,
      tech_id:      techId ?? (type === 'labor' ? job.assigned_tech_id : null),
      unit_cost:    round2(unitCost),
      unit_price:   round2(unitPrice),
      total:        round2(quantity * unitPrice),
      inventory_id: inventoryId,
    })
    .select('*')
    .maybeSingle<ShopJobLineItem>()

  if (insertError || !created) {
    return apiError(insertError?.message ?? 'Could not add the line item.', 400)
  }

  return Response.json(
    { lineItem: toLineItemView(created, ctx.permissions.viewMargins) },
    { status: 201 },
  )
}

/** Shop-scoped job lookup that also applies the tech's own-jobs-only rule. */
async function findAccessibleJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  shopId: string,
  scope: { viewAllJobs: boolean; techId: string },
): Promise<ShopJob | null> {
  const query = supabase
    .from('shop_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('shop_id', shopId)
  const scoped = scope.viewAllJobs ? query : query.eq('assigned_tech_id', scope.techId)
  const { data } = await scoped.maybeSingle<ShopJob>()
  return data ?? null
}

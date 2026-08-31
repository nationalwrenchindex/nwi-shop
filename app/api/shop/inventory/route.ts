// GET  /api/shop/inventory  — search + filter the parts list (any shop member).
// POST /api/shop/inventory  — create a part (manageInventory).
//
// Unit cost is removed from every response for callers without `viewMargins`
// (a foreman): the key is deleted server-side, so the number never crosses the
// wire at all.

import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  asRecord,
  isInventoryLoc,
  isLowStock,
  sanitizeSearch,
  sellPriceFromCost,
  stripPartCost,
  toNumber,
  toText,
} from '@/lib/shop/inventory'
import type { ShopInventory } from '@/lib/types'

export async function GET(request: Request) {
  const { ctx, error } = await apiContext()
  if (error) return error

  const url = new URL(request.url)
  const q = sanitizeSearch(url.searchParams.get('q') ?? '')
  const location = url.searchParams.get('location')
  const lowOnly = url.searchParams.get('low') === '1'

  const supabase = await createClient()

  let query = supabase
    .from('shop_inventory')
    .select('*')
    .eq('shop_id', ctx.shop.id)
    .order('part_number', { ascending: true })

  if (isInventoryLoc(location)) query = query.eq('location', location)
  if (q) {
    query = query.or(
      `part_number.ilike.%${q}%,description.ilike.%${q}%,manufacturer.ilike.%${q}%`,
    )
  }

  const { data, error: dbError } = await query.returns<ShopInventory[]>()

  if (dbError) {
    // Migrations may not be applied yet — degrade to an empty list rather than
    // taking the whole page down.
    return Response.json({ parts: [], warning: dbError.message }, { status: 200 })
  }

  const rows = lowOnly ? (data ?? []).filter(isLowStock) : (data ?? [])

  return Response.json({
    parts: rows.map((part) => stripPartCost(part, ctx.permissions.viewMargins)),
  })
}

export async function POST(request: Request) {
  const { ctx, error } = await apiContext('manageInventory')
  if (error) return error

  const body = asRecord(await request.json().catch(() => null))

  const partNumber = toText(body.part_number)
  const description = toText(body.description)
  const location = body.location

  if (!partNumber) {
    return Response.json({ error: 'Part number is required.' }, { status: 400 })
  }
  if (!description) {
    return Response.json({ error: 'Description is required.' }, { status: 400 })
  }
  if (!isInventoryLoc(location)) {
    return Response.json(
      { error: 'Location must be either "shop" or "vehicle".' },
      { status: 400 },
    )
  }

  // Counts are numeric, not integer — fluids and wire are stocked in quarts and feet.
  const quantity = Math.max(0, toNumber(body.quantity_on_hand) ?? 0)
  const reorderPoint = Math.max(0, toNumber(body.reorder_point) ?? 0)

  // A caller without viewMargins never submits a cost; the part is created at a
  // cost of 0 and a manager can fill it in later.
  const unitCost = ctx.permissions.viewMargins ? Math.max(0, toNumber(body.unit_cost) ?? 0) : 0
  const submittedPrice = toNumber(body.unit_price)
  const unitPrice =
    submittedPrice !== null && submittedPrice >= 0 ? submittedPrice : sellPriceFromCost(unitCost)

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('shop_inventory')
    .select('id')
    .eq('shop_id', ctx.shop.id)
    .eq('part_number', partNumber)
    .eq('location', location)
    .maybeSingle<{ id: string }>()

  if (existing) {
    return Response.json(
      {
        error: `Part ${partNumber} already exists at this location. Receive stock against the existing part instead.`,
      },
      { status: 409 },
    )
  }

  const { data, error: dbError } = await supabase
    .from('shop_inventory')
    .insert({
      shop_id:          ctx.shop.id,
      location,
      part_number:      partNumber,
      description,
      manufacturer:     toText(body.manufacturer),
      quantity_on_hand: quantity,
      reorder_point:    reorderPoint,
      unit_cost:        unitCost,
      unit_price:       unitPrice,
      vendor:           toText(body.vendor),
    })
    .select('*')
    .single<ShopInventory>()

  if (dbError || !data) {
    // 23505 is Postgres' unique_violation — the race the pre-check can lose.
    const duplicate = typeof dbError?.code === 'string' && dbError.code === '23505'
    return Response.json(
      {
        error: duplicate
          ? `Part ${partNumber} already exists at this location.`
          : (dbError?.message ?? 'Could not create the part.'),
      },
      { status: duplicate ? 409 : 500 },
    )
  }

  // Opening stock is a real movement — record it so the history reconciles.
  if (quantity > 0) {
    await supabase.from('shop_inventory_transactions').insert({
      shop_id:      ctx.shop.id,
      inventory_id: data.id,
      job_id:       null,
      tech_id:      ctx.tech.id,
      type:         'received',
      quantity,
      cost:         Math.round(quantity * unitCost * 100) / 100,
      notes:        'Opening stock',
    })
  }

  return Response.json(
    { part: stripPartCost(data, ctx.permissions.viewMargins) },
    { status: 201 },
  )
}

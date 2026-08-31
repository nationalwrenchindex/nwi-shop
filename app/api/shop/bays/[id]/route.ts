// PATCH  /api/shop/bays/[id] - label, type, status, sort order.
// DELETE /api/shop/bays/[id] - removes an empty bay.
//
// Setting a bay to `available` or `out_of_service` clears `current_job_id`, and
// a bay may not be marked `occupied` through this route: occupancy is a side
// effect of assigning a job (see /api/shop/jobs/[id]).

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, asNumber, asText, readJsonBody } from '@/lib/shop/jobs'
import type { BayStatus, BayType, ShopBay } from '@/lib/types'

type Params = { params: Promise<{ id: string }> }

const BAY_TYPES: readonly BayType[] = ['lift', 'flat', 'alignment', 'other']

function asBayType(value: unknown): BayType | null {
  return typeof value === 'string' && (BAY_TYPES as readonly string[]).includes(value)
    ? (value as BayType)
    : null
}

/** Only the two states a human sets directly. */
function asManualBayStatus(value: unknown): BayStatus | null {
  return value === 'available' || value === 'out_of_service' ? value : null
}

type BayPatch = Partial<Pick<ShopBay, 'label' | 'type' | 'status' | 'current_job_id' | 'sort_order'>>

export async function PATCH(req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext('manageBays')
  if (error) return error

  const { id } = await params
  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const supabase = await createClient()

  const { data: bay } = await supabase
    .from('shop_bays')
    .select('*')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<ShopBay>()
  if (!bay) return apiError('Bay not found.', 404)

  const patch: BayPatch = {}

  if ('label' in body) {
    const label = asText(body.label)
    if (!label) return apiError('A bay label is required.', 400)
    patch.label = label
  }

  if ('type' in body) {
    const type = asBayType(body.type)
    if (!type) return apiError('Unknown bay type.', 400)
    patch.type = type
  }

  if ('sort_order' in body) {
    const sortOrder = asNumber(body.sort_order)
    if (sortOrder === null) return apiError('`sort_order` must be a number.', 400)
    patch.sort_order = sortOrder
  }

  if ('status' in body) {
    const status = asManualBayStatus(body.status)
    if (!status) {
      return apiError('Set a bay to "available" or "out_of_service"; assign a job to occupy it.', 400)
    }
    if (bay.current_job_id) {
      // Freeing a bay by hand also detaches the job sitting in it, otherwise the
      // job would point at a bay that no longer holds it.
      await supabase
        .from('shop_jobs')
        .update({ bay_id: null, bay_assigned_at: null })
        .eq('id', bay.current_job_id)
        .eq('shop_id', ctx.shop.id)
    }
    patch.status = status
    patch.current_job_id = null
  }

  if (Object.keys(patch).length === 0) return apiError('Nothing to update.', 400)

  const { data: updated, error: updateError } = await supabase
    .from('shop_bays')
    .update(patch)
    .eq('id', bay.id)
    .eq('shop_id', ctx.shop.id)
    .select('*')
    .maybeSingle<ShopBay>()

  if (updateError || !updated) {
    return apiError(updateError?.message ?? 'Could not update the bay.', 400)
  }

  return Response.json({ bay: updated })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext('manageBays')
  if (error) return error

  const { id } = await params
  const supabase = await createClient()

  const { data: bay } = await supabase
    .from('shop_bays')
    .select('*')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<ShopBay>()
  if (!bay) return apiError('Bay not found.', 404)

  if (bay.current_job_id) {
    return apiError('Move the job out of this bay before deleting it.', 409)
  }

  const { error: deleteError } = await supabase
    .from('shop_bays')
    .delete()
    .eq('id', bay.id)
    .eq('shop_id', ctx.shop.id)

  if (deleteError) return apiError(deleteError.message, 400)

  return Response.json({ ok: true })
}

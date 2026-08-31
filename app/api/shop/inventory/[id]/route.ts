// GET / PATCH / DELETE a single part. Every query is scoped to the caller's
// shop_id as well as the row id, so an id from another shop reads as 404.

import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  asRecord,
  isInventoryLoc,
  sellPriceFromCost,
  stripPartCost,
  toNumber,
  toText,
} from '@/lib/shop/inventory'
import type { ShopInventory } from '@/lib/types'

interface Context {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: Context) {
  const { ctx, error } = await apiContext()
  if (error) return error

  const { id } = await context.params
  const supabase = await createClient()

  const { data } = await supabase
    .from('shop_inventory')
    .select('*')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<ShopInventory>()

  if (!data) return Response.json({ error: 'Part not found.' }, { status: 404 })

  return Response.json({ part: stripPartCost(data, ctx.permissions.viewMargins) })
}

export async function PATCH(request: Request, context: Context) {
  const { ctx, error } = await apiContext('manageInventory')
  if (error) return error

  const { id } = await context.params
  const body = asRecord(await request.json().catch(() => null))
  const supabase = await createClient()

  const { data: current } = await supabase
    .from('shop_inventory')
    .select('*')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<ShopInventory>()

  if (!current) return Response.json({ error: 'Part not found.' }, { status: 404 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  const partNumber = toText(body.part_number)
  if (partNumber) patch.part_number = partNumber

  const description = toText(body.description)
  if (description) patch.description = description

  if ('manufacturer' in body) patch.manufacturer = toText(body.manufacturer)
  if ('vendor' in body) patch.vendor = toText(body.vendor)
  if (isInventoryLoc(body.location)) patch.location = body.location

  const quantity = toNumber(body.quantity_on_hand)
  if (quantity !== null) patch.quantity_on_hand = Math.max(0, quantity)

  const reorder = toNumber(body.reorder_point)
  if (reorder !== null) patch.reorder_point = Math.max(0, reorder)

  // Cost is writable only by callers who are allowed to see it. A foreman's
  // PATCH silently leaves unit_cost where it was.
  let effectiveCost = current.unit_cost
  if (ctx.permissions.viewMargins) {
    const cost = toNumber(body.unit_cost)
    if (cost !== null && cost >= 0) {
      effectiveCost = cost
      patch.unit_cost = cost
    }
  }

  const price = toNumber(body.unit_price)
  if (price !== null && price >= 0) {
    patch.unit_price = price
  } else if ('unit_cost' in patch) {
    // Cost moved with no explicit price — re-derive at the house markup.
    patch.unit_price = sellPriceFromCost(effectiveCost)
  }

  const { data, error: dbError } = await supabase
    .from('shop_inventory')
    .update(patch)
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .select('*')
    .single<ShopInventory>()

  if (dbError || !data) {
    return Response.json(
      { error: dbError?.message ?? 'Could not update the part.' },
      { status: 500 },
    )
  }

  // A manual quantity correction is an `adjusted` movement.
  if (typeof patch.quantity_on_hand === 'number' && patch.quantity_on_hand !== current.quantity_on_hand) {
    const delta = patch.quantity_on_hand - current.quantity_on_hand
    await supabase.from('shop_inventory_transactions').insert({
      shop_id:      ctx.shop.id,
      inventory_id: id,
      job_id:       null,
      tech_id:      ctx.tech.id,
      type:         'adjusted',
      quantity:     delta,
      cost:         Math.round(delta * effectiveCost * 100) / 100,
      notes:        toText(body.notes) ?? 'Manual quantity adjustment',
    })
  }

  return Response.json({ part: stripPartCost(data, ctx.permissions.viewMargins) })
}

export async function DELETE(_request: Request, context: Context) {
  const { ctx, error } = await apiContext('manageInventory')
  if (error) return error

  const { id } = await context.params
  const supabase = await createClient()

  const { error: dbError } = await supabase
    .from('shop_inventory')
    .delete()
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)

  if (dbError) {
    return Response.json(
      { error: `Could not delete the part: ${dbError.message}` },
      { status: 500 },
    )
  }

  return Response.json({ ok: true })
}

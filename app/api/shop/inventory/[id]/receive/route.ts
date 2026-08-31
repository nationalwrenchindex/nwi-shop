// POST /api/shop/inventory/[id]/receive — book stock in against a part.
//
// An optional updated unit cost re-prices the part at the house markup. Only a
// caller with viewMargins may send one; a foreman's receive leaves cost and
// price untouched.

import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { asRecord, roundCents, sellPriceFromCost, stripPartCost, toNumber, toText } from '@/lib/shop/inventory'
import type { ShopInventory } from '@/lib/types'

interface Context {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, context: Context) {
  const { ctx, error } = await apiContext('manageInventory')
  if (error) return error

  const { id } = await context.params
  const body = asRecord(await request.json().catch(() => null))

  const quantity = toNumber(body.quantity) ?? 0
  if (quantity <= 0) {
    return Response.json({ error: 'Enter a quantity greater than zero.' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: part } = await supabase
    .from('shop_inventory')
    .select('*')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<ShopInventory>()

  if (!part) return Response.json({ error: 'Part not found.' }, { status: 404 })

  const submittedCost = ctx.permissions.viewMargins ? toNumber(body.unit_cost) : null
  const costChanged = submittedCost !== null && submittedCost >= 0
  const unitCost = costChanged ? submittedCost : part.unit_cost

  const submittedPrice = ctx.permissions.viewMargins ? toNumber(body.unit_price) : null
  const unitPrice =
    submittedPrice !== null && submittedPrice >= 0
      ? submittedPrice
      : costChanged
        ? sellPriceFromCost(unitCost)
        : part.unit_price

  const { data: updated, error: updateError } = await supabase
    .from('shop_inventory')
    .update({
      quantity_on_hand: part.quantity_on_hand + quantity,
      unit_cost:        unitCost,
      unit_price:       unitPrice,
      updated_at:       new Date().toISOString(),
    })
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    // Optimistic concurrency: only apply if nobody moved the quantity between
    // the read above and this write.
    .eq('quantity_on_hand', part.quantity_on_hand)
    .select('*')
    .maybeSingle<ShopInventory>()

  if (updateError || !updated) {
    return Response.json(
      {
        error:
          updateError?.message ??
          'That part changed while you were receiving it. Reopen the part and try again.',
      },
      { status: updateError ? 500 : 409 },
    )
  }

  const { error: txError } = await supabase.from('shop_inventory_transactions').insert({
    shop_id:      ctx.shop.id,
    inventory_id: id,
    job_id:       null,
    tech_id:      ctx.tech.id,
    type:         'received',
    quantity,
    cost:         roundCents(quantity * unitCost),
    notes:        toText(body.notes),
  })

  if (txError) {
    // The stock movement is what matters and it succeeded; we surface the
    // missing audit row rather than rolling back a legitimate receipt.
    return Response.json({
      part:    stripPartCost(updated, ctx.permissions.viewMargins),
      warning: `Stock updated, but the transaction record failed to write: ${txError.message}`,
    })
  }

  return Response.json({ part: stripPartCost(updated, ctx.permissions.viewMargins) })
}

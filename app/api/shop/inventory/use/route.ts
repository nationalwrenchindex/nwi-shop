// POST /api/shop/inventory/use — consume a part on a job.
//
// Three writes have to happen together: the stock comes down, a `used`
// transaction is recorded, and the part lands on the job as a billable line
// item. Supabase's REST interface gives us no multi-statement transaction, so
// this is a best-effort saga executed server-side in a fixed order with
// compensating writes. Honest limitation: if the process dies between two
// steps, or a compensating write itself fails, the data can be left
// inconsistent — a Postgres function (RPC) is the real fix and should replace
// the body of this handler once one exists.

import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { asRecord, roundCents, stripPartCost, toNumber, toText } from '@/lib/shop/inventory'
import type { ShopInventory, ShopJob, ShopTech } from '@/lib/types'

export async function POST(request: Request) {
  const { ctx, error } = await apiContext('manageInventory')
  if (error) return error

  const body = asRecord(await request.json().catch(() => null))

  const inventoryId = toText(body.inventory_id)
  const jobId = toText(body.job_id)
  const quantity = toNumber(body.quantity) ?? 0

  if (!inventoryId) return Response.json({ error: 'Pick a part.' }, { status: 400 })
  if (!jobId) return Response.json({ error: 'Pick a job.' }, { status: 400 })
  if (quantity <= 0) {
    return Response.json({ error: 'Enter a quantity greater than zero.' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: part } = await supabase
    .from('shop_inventory')
    .select('*')
    .eq('id', inventoryId)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<ShopInventory>()

  if (!part) return Response.json({ error: 'Part not found.' }, { status: 404 })

  if (part.quantity_on_hand < quantity) {
    return Response.json(
      {
        error: `Only ${part.quantity_on_hand} of ${part.part_number} on hand — you tried to use ${quantity}.`,
      },
      { status: 400 },
    )
  }

  // The job must belong to this shop; an id from another shop reads as missing.
  // The voided / invoiced guards mirror POST /api/shop/jobs/[id]/line-items so
  // the direct insert below cannot slip a part past a closed job.
  const { data: job } = await supabase
    .from('shop_jobs')
    .select('id, job_number, status, voided')
    .eq('id', jobId)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<Pick<ShopJob, 'id' | 'job_number' | 'status' | 'voided'>>()

  if (!job) return Response.json({ error: 'Job not found for this shop.' }, { status: 404 })
  if (job.voided) {
    return Response.json({ error: 'That job has been voided.' }, { status: 409 })
  }
  if (job.status === 'invoiced') {
    return Response.json({ error: 'That job is already invoiced.' }, { status: 409 })
  }

  // Whoever pulled the part, defaulting to the signed-in user.
  let techId: string | null = ctx.tech.id
  const submittedTech = toText(body.tech_id)
  if (submittedTech) {
    const { data: tech } = await supabase
      .from('shop_techs')
      .select('id')
      .eq('id', submittedTech)
      .eq('shop_id', ctx.shop.id)
      .maybeSingle<Pick<ShopTech, 'id'>>()
    techId = tech ? tech.id : ctx.tech.id
  }

  const nextQuantity = part.quantity_on_hand - quantity

  // --- Step 1: take the stock down (optimistic concurrency on the quantity we
  // read, so two techs pulling the last part cannot both succeed). ------------
  const { data: updated, error: updateError } = await supabase
    .from('shop_inventory')
    .update({ quantity_on_hand: nextQuantity, updated_at: new Date().toISOString() })
    .eq('id', inventoryId)
    .eq('shop_id', ctx.shop.id)
    .eq('quantity_on_hand', part.quantity_on_hand)
    .select('*')
    .maybeSingle<ShopInventory>()

  if (updateError || !updated) {
    return Response.json(
      {
        error:
          updateError?.message ??
          'Stock for that part changed while you were using it. Refresh and try again.',
      },
      { status: updateError ? 500 : 409 },
    )
  }

  const restoreStock = async () => {
    await supabase
      .from('shop_inventory')
      .update({ quantity_on_hand: part.quantity_on_hand, updated_at: new Date().toISOString() })
      .eq('id', inventoryId)
      .eq('shop_id', ctx.shop.id)
      .eq('quantity_on_hand', nextQuantity)
  }

  // --- Step 2: put the part on the job. ------------------------------------
  // Shared shape with POST /api/shop/jobs/[id]/line-items (owned by the jobs
  // area): { type:'part', description, part_number, quantity, unit_cost,
  // unit_price, inventory_id, tech_id }. That route computes `total` itself; we
  // insert the row directly with the caller's own session rather than making a
  // self-HTTP call back into our own server, so `total` is computed here to the
  // same rule: quantity x unit_price.
  const lineItem = {
    job_id:       jobId,
    shop_id:      ctx.shop.id,
    type:         'part' as const,
    description:  part.description,
    part_number:  part.part_number,
    quantity,
    tech_id:      techId,
    unit_cost:    part.unit_cost,
    unit_price:   part.unit_price,
    total:        roundCents(quantity * part.unit_price),
    inventory_id: inventoryId,
  }

  const { data: insertedItem, error: lineError } = await supabase
    .from('shop_job_line_items')
    .insert(lineItem)
    .select('id')
    .single<{ id: string }>()

  if (lineError || !insertedItem) {
    await restoreStock()
    return Response.json(
      {
        error: `Could not add the part to job #${job.job_number}, so the stock was put back: ${
          lineError?.message ?? 'unknown error'
        }`,
      },
      { status: 500 },
    )
  }

  // --- Step 3: the audit trail. --------------------------------------------
  // The ledger's `quantity` carries its own sign so it sums straight to the
  // on-hand figure — stock leaving the shelf is negative, and `cost` follows
  // the same convention.
  const { error: txError } = await supabase.from('shop_inventory_transactions').insert({
    shop_id:      ctx.shop.id,
    inventory_id: inventoryId,
    job_id:       jobId,
    tech_id:      techId,
    type:         'used',
    quantity:     -quantity,
    cost:         -roundCents(quantity * part.unit_cost),
    notes:        toText(body.notes),
  })

  if (txError) {
    // Unwind in reverse: pull the line item back off the job, then restore the
    // stock. If either compensating write fails there is nothing further this
    // layer can do, which is exactly why this belongs in a DB function.
    await supabase
      .from('shop_job_line_items')
      .delete()
      .eq('id', insertedItem.id)
      .eq('shop_id', ctx.shop.id)
    await restoreStock()
    return Response.json(
      { error: `Could not record the movement, so nothing was changed: ${txError.message}` },
      { status: 500 },
    )
  }

  return Response.json({
    part:         stripPartCost(updated, ctx.permissions.viewMargins),
    job_number:   job.job_number,
    line_item_id: insertedItem.id,
  })
}

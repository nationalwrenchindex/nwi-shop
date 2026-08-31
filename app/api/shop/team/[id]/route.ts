import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { TIER_LIMITS, withinLimit } from '@/lib/permissions'
import type { ShopTech } from '@/lib/types'
import { parseTechBody } from '../_payload'

export async function PATCH(
  request: Request,
  context: RouteContext<'/api/shop/team/[id]'>,
) {
  const { ctx, error } = await apiContext('manageTechs')
  if (error) return error

  // Next 16: route params arrive as a Promise.
  const { id } = await context.params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { data, error: parseError } = parseTechBody(raw, ctx.permissions.viewPayRates)
  if (parseError) return Response.json({ error: parseError }, { status: 400 })

  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const supabase = await createClient()

  // Scoped read first: proves the record belongs to the caller's shop before we
  // decide whether the caller outranks it.
  const { data: existing, error: readError } = await supabase
    .from('shop_techs')
    .select('*')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<ShopTech>()

  if (readError) return Response.json({ error: readError.message }, { status: 500 })
  if (!existing) return Response.json({ error: 'Tech not found' }, { status: 404 })

  // A foreman may run the roster but must never edit a manager or promote
  // anyone to manager — that would be a self-service privilege escalation.
  if (ctx.role !== 'manager' && (existing.role === 'manager' || data.role === 'manager')) {
    return Response.json(
      { error: 'Only a shop manager can manage manager accounts' },
      { status: 403 },
    )
  }

  if (data.active === false && existing.id === ctx.tech.id) {
    return Response.json({ error: 'You cannot deactivate yourself' }, { status: 400 })
  }

  // Reactivating consumes a seat, so it is limit-checked like a create.
  if (data.active === true && !existing.active) {
    const tier = ctx.subscription?.tier ?? ctx.shop.subscription_tier
    const limit = TIER_LIMITS[tier].techs
    const { count } = await supabase
      .from('shop_techs')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', ctx.shop.id)
      .eq('active', true)

    if (!withinLimit(limit, count ?? 0)) {
      return Response.json(
        {
          error: `Your plan includes ${limit} tech seats. Upgrade your plan to reactivate.`,
          limitReached: true,
        },
        { status: 403 },
      )
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from('shop_techs')
    .update(data)
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .select('*')
    .single<ShopTech>()

  if (updateError) return Response.json({ error: updateError.message }, { status: 500 })

  // Never hand a pay rate back to a caller who is not allowed to see one.
  if (!ctx.permissions.viewPayRates && updated) {
    return Response.json({ tech: { ...updated, pay_rate: null } })
  }
  return Response.json({ tech: updated })
}

/** Soft delete — techs are deactivated so their timeclock history survives. */
export async function DELETE(
  _request: Request,
  context: RouteContext<'/api/shop/team/[id]'>,
) {
  const { ctx, error } = await apiContext('manageTechs')
  if (error) return error

  const { id } = await context.params

  if (id === ctx.tech.id) {
    return Response.json({ error: 'You cannot deactivate yourself' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: existing, error: readError } = await supabase
    .from('shop_techs')
    .select('id, role')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<Pick<ShopTech, 'id' | 'role'>>()

  if (readError) return Response.json({ error: readError.message }, { status: 500 })
  if (!existing) return Response.json({ error: 'Tech not found' }, { status: 404 })

  if (ctx.role !== 'manager' && existing.role === 'manager') {
    return Response.json(
      { error: 'Only a shop manager can deactivate a manager' },
      { status: 403 },
    )
  }

  const { error: updateError } = await supabase
    .from('shop_techs')
    .update({ active: false })
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)

  if (updateError) return Response.json({ error: updateError.message }, { status: 500 })
  return Response.json({ ok: true })
}

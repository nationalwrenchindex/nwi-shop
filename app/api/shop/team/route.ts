// Tech roster API. Every handler re-derives the caller's shop and role from the
// session — nothing about identity or scope is taken from the request body.

import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { TIER_LIMITS, withinLimit } from '@/lib/permissions'
import type { ShopRole, ShopTech } from '@/lib/types'
import { SAFE_TECH_COLUMNS, parseTechBody } from './_payload'

export async function GET() {
  const { ctx, error } = await apiContext('manageTechs')
  if (error) return error

  const supabase = await createClient()
  const columns = ctx.permissions.viewPayRates ? '*' : SAFE_TECH_COLUMNS

  const { data, error: dbError } = await supabase
    .from('shop_techs')
    .select(columns)
    .eq('shop_id', ctx.shop.id)
    .order('active', { ascending: false })
    .order('last_name', { ascending: true })

  if (dbError) return Response.json({ error: dbError.message }, { status: 500 })
  return Response.json({ techs: data ?? [] })
}

export async function POST(request: Request) {
  const { ctx, error } = await apiContext('manageTechs')
  if (error) return error

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { data, error: parseError } = parseTechBody(raw, ctx.permissions.viewPayRates)
  if (parseError) return Response.json({ error: parseError }, { status: 400 })

  if (!data.first_name || !data.last_name) {
    return Response.json({ error: 'First and last name are required' }, { status: 400 })
  }

  const role: ShopRole = data.role ?? 'tech'
  // Only a manager may mint another manager. A foreman has manageTechs but must
  // not be able to escalate anyone — themselves included — to full access.
  if (role === 'manager' && ctx.role !== 'manager') {
    return Response.json(
      { error: 'Only a shop manager can add another manager' },
      { status: 403 },
    )
  }

  const supabase = await createClient()

  // Seat limit counts active techs against the shop's current tier.
  const tier = ctx.subscription?.tier ?? ctx.shop.subscription_tier
  const limit = TIER_LIMITS[tier].techs
  const { count, error: countError } = await supabase
    .from('shop_techs')
    .select('id', { count: 'exact', head: true })
    .eq('shop_id', ctx.shop.id)
    .eq('active', true)

  if (countError) return Response.json({ error: countError.message }, { status: 500 })

  if (!withinLimit(limit, count ?? 0)) {
    return Response.json(
      {
        error: `Your plan includes ${limit} tech seats. Upgrade your plan to add more.`,
        limitReached: true,
      },
      { status: 403 },
    )
  }

  const insert = {
    shop_id: ctx.shop.id,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email ?? null,
    phone: data.phone ?? null,
    role,
    hire_date: data.hire_date ?? null,
    active: data.active ?? true,
    ...(ctx.permissions.viewPayRates ? { pay_rate: data.pay_rate ?? null } : {}),
  }

  const { data: created, error: insertError } = await supabase
    .from('shop_techs')
    .insert(insert)
    .select('*')
    .single<ShopTech>()

  if (insertError) return Response.json({ error: insertError.message }, { status: 500 })
  return Response.json({ tech: created }, { status: 201 })
}

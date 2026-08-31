// GET  /api/shop/bays - every bay in the caller's shop, in sort order.
// POST /api/shop/bays - add a bay. Capped by the shop's tier (TIER_LIMITS.bays).

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { TIER_LABELS, TIER_LIMITS, withinLimit } from '@/lib/permissions'
import { apiError, asNumber, asText, readJsonBody } from '@/lib/shop/jobs'
import type { BayType, ShopBay } from '@/lib/types'

const BAY_TYPES: readonly BayType[] = ['lift', 'flat', 'alignment', 'other']

function asBayType(value: unknown): BayType | null {
  return typeof value === 'string' && (BAY_TYPES as readonly string[]).includes(value)
    ? (value as BayType)
    : null
}

export async function GET() {
  const { ctx, error } = await apiContext()
  if (error) return error

  const supabase = await createClient()
  const { data } = await supabase
    .from('shop_bays')
    .select('*')
    .eq('shop_id', ctx.shop.id)
    .order('sort_order', { ascending: true })
    .returns<ShopBay[]>()

  return Response.json({ bays: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await apiContext('manageBays')
  if (error) return error

  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const label = asText(body.label)
  if (!label) return apiError('A bay label is required.', 400)

  const type = asBayType(body.type) ?? 'lift'
  const supabase = await createClient()

  const { count } = await supabase
    .from('shop_bays')
    .select('id', { count: 'exact', head: true })
    .eq('shop_id', ctx.shop.id)

  // The subscription row is authoritative when present; the profile tier is the
  // fallback for a shop that has not finished checkout.
  const tier = ctx.subscription?.tier ?? ctx.shop.subscription_tier
  const limit = TIER_LIMITS[tier].bays
  if (!withinLimit(limit, count ?? 0)) {
    return apiError(
      `${TIER_LABELS[tier]} includes ${limit} bays. Upgrade your plan to add another.`,
      403,
    )
  }

  const sortOrder = asNumber(body.sort_order) ?? (count ?? 0) + 1

  const { data: bay, error: insertError } = await supabase
    .from('shop_bays')
    .insert({
      shop_id:        ctx.shop.id,
      label,
      type,
      status:         'available',
      current_job_id: null,
      sort_order:     sortOrder,
    })
    .select('*')
    .maybeSingle<ShopBay>()

  if (insertError || !bay) {
    return apiError(insertError?.message ?? 'Could not create the bay.', 400)
  }

  return Response.json({ bay }, { status: 201 })
}

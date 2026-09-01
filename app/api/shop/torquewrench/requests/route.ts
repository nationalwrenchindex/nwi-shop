// GET /api/shop/torquewrench/requests — recent review requests for the dashboard.
//
// The phone number and the customer name are already visible to anyone with
// `manageCustomers`, so nothing is redacted here. The request `token` is NOT
// returned: it is the credential in the customer's link, and the dashboard has
// no reason to hold it.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { loadReviewRequests } from '@/lib/shop/torquewrench/data'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function GET(req: NextRequest) {
  const { ctx, error } = await apiFeature('torquewrench', 'manageCustomers')
  if (error) return error

  const raw = Number(req.nextUrl.searchParams.get('limit'))
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(MAX_LIMIT, Math.floor(raw)) : DEFAULT_LIMIT

  const supabase = await createClient()
  const { rows, tablesMissing } = await loadReviewRequests(supabase, ctx.shop.id, limit)

  return Response.json({ requests: rows, tablesMissing })
}

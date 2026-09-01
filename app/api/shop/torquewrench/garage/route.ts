// POST /api/shop/torquewrench/garage  { job_id }
//
// Posts one invoiced job into the customer's NWI Garage.
//
// ── ON THIS PATH ────────────────────────────────────────────────────────────
// Garage sync has nothing to do with TorqueWrench reviews — it is gated on its
// own `garage_sync` feature and reads none of the review tables. It lives under
// /api/shop/torquewrench's folder only because this build's file set was scoped
// that way. The natural home is /api/shop/garage, and moving it is a rename of
// this directory plus the one fetch() in
// app/shop/(app)/tools/garage-sync/_components/garage-table.tsx.
//
// Always returns 200 with a named outcome unless the caller is unauthorised or
// sent a bad body. "The customer has no NWI Garage" is a normal result, not an
// error, and the UI prints the `message` verbatim — see lib/shop/garage.ts on
// why this never reports a success it did not get.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, asText, readJsonBody } from '@/lib/shop/jobs'
import { loadGarageSyncInput, syncJobToGarage } from '@/lib/shop/garage'

export async function POST(req: NextRequest) {
  const { ctx, error } = await apiFeature('garage_sync', 'manageCustomers')
  if (error) return error

  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const jobId = asText(body.job_id)
  if (!jobId) return apiError('A job_id is required.', 400)

  const supabase = await createClient()
  const input = await loadGarageSyncInput(supabase, ctx.shop, jobId)
  if (!input) return apiError('That job does not exist in this shop.', 404)

  const result = await syncJobToGarage(input)
  return Response.json(result)
}

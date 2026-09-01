// GET /api/shop/tools/quickwrench-ld/complaints?year&make&model
//
// NHTSA owner complaints, grouped by component — a fast read on what actually
// fails on this platform. NO Gemini: works without GEMINI_API_KEY.
//
// NAMING: NWI Suite serves this from a route it calls `tsb`, but the endpoint
// behind it is complaintsByVehicle. These are owner-reported complaints, NOT
// manufacturer Technical Service Bulletins, and are named honestly here.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { fetchComplaints } from '@/lib/shop/quickwrench/ld-nhtsa'
import { ldError, readVehicleQuery } from '@/lib/shop/quickwrench/ld-http'
import { NHTSA_DISCLAIMER } from '@/lib/shop/quickwrench/ld'

export async function GET(req: NextRequest) {
  const { error } = await apiFeature('quickwrench_ld')
  if (error) return error

  const query = readVehicleQuery(req.nextUrl.searchParams)
  if (!query) return ldError('year, make and model are required.', 400)

  const result = await fetchComplaints(query)
  if (!result.ok) return ldError(result.message, 502)

  return Response.json({
    groups:     result.data.groups,
    total:      result.data.total,
    message:    result.message,
    disclaimer: NHTSA_DISCLAIMER,
  })
}

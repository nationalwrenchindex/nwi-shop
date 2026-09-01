// GET /api/shop/tools/quickwrench-ld/recalls?year&make&model
//
// NHTSA recall campaigns. NO Gemini — works without GEMINI_API_KEY.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { fetchRecalls } from '@/lib/shop/quickwrench/ld-nhtsa'
import { ldError, readVehicleQuery } from '@/lib/shop/quickwrench/ld-http'
import { NHTSA_DISCLAIMER } from '@/lib/shop/quickwrench/ld'

export async function GET(req: NextRequest) {
  const { error } = await apiFeature('quickwrench_ld')
  if (error) return error

  const query = readVehicleQuery(req.nextUrl.searchParams)
  if (!query) return ldError('year, make and model are required.', 400)

  const result = await fetchRecalls(query)
  if (!result.ok) return ldError(result.message, 502)

  return Response.json({
    recalls:    result.data,
    count:      result.data.length,
    message:    result.message,
    disclaimer: NHTSA_DISCLAIMER,
  })
}

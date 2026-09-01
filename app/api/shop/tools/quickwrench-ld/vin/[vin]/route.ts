// GET /api/shop/tools/quickwrench-ld/vin/[vin]
//
// NHTSA vPIC decode. NO Gemini — this route works on a deployment with no
// GEMINI_API_KEY, which is what lets a tech identify the vehicle and pull
// recalls even when diagnostics are switched off.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { decodeVin } from '@/lib/shop/quickwrench/ld-nhtsa'
import { ldError } from '@/lib/shop/quickwrench/ld-http'

type Params = { params: Promise<{ vin: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { error } = await apiFeature('quickwrench_ld')
  if (error) return error

  const { vin } = await params
  const result = await decodeVin(vin)

  // decodeVin never throws; a bad VIN and an NHTSA outage both land here with a
  // message the UI can show verbatim.
  if (!result.ok) return ldError(result.message, 422)

  return Response.json({ vehicle: result.data, message: result.message })
}

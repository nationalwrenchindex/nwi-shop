// GET /api/shop/tools/quickwrench-ld/dtc/[code]?year&make&model&engine&display
//
// What one OBD-II code means on THIS vehicle. `params` is a Promise in Next 16.
// Requires GEMINI_API_KEY.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { geminiNotConfigured, isGeminiConfigured } from '@/lib/gemini'
import { isValidDtc } from '@/lib/shop/quickwrench/ld'
import { runDiagnosis } from '@/lib/shop/quickwrench/ld-diagnose'
import { ldError, text } from '@/lib/shop/quickwrench/ld-http'

export const maxDuration = 60

type Params = { params: Promise<{ code: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { error } = await apiFeature('quickwrench_ld')
  if (error) return error

  if (!isGeminiConfigured()) return geminiNotConfigured()

  const { code } = await params
  const normalized = code.trim().toUpperCase()
  if (!isValidDtc(normalized)) {
    return ldError('Invalid DTC format. Expected e.g. P0420.', 400)
  }

  const q = req.nextUrl.searchParams
  const outcome = await runDiagnosis({
    code:    normalized,
    issue:   '',
    display: text(q.get('display')),
    year:    text(q.get('year')),
    make:    text(q.get('make')),
    model:   text(q.get('model')),
    engine:  text(q.get('engine')),
  })

  if (!outcome.ok) return ldError(outcome.message, outcome.status)
  return Response.json(outcome.payload)
}

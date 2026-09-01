// POST /api/shop/tools/quickwrench-ld/diagnose
//
// Accepts an optional DTC code OR a symptom description. With a valid code it
// behaves exactly like /dtc/[code]; without one it runs a symptom-based
// diagnosis (code = 'NO-CODE'). Same structured shape either way.
//
// Requires GEMINI_API_KEY. The NHTSA routes in this folder do not.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { geminiNotConfigured, isGeminiConfigured } from '@/lib/gemini'
import { runDiagnosis } from '@/lib/shop/quickwrench/ld-diagnose'
import { isValidDtc } from '@/lib/shop/quickwrench/ld'
import { ldError, readJsonBody, text } from '@/lib/shop/quickwrench/ld-http'

// Grounded generation runs up to 55s inside lib/gemini; 60s keeps the platform
// from killing the request first.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { error } = await apiFeature('quickwrench_ld')
  if (error) return error

  if (!isGeminiConfigured()) return geminiNotConfigured()

  const body = await readJsonBody(req)
  if (!body) return ldError('Expected a JSON object body.', 400)

  const rawCode = text(body.code).toUpperCase()
  const display = text(body.displayMessage)
  const symptom = text(body.symptom)

  // An unrecognised code string is not silently dropped — a tech who typed
  // "P042" needs to know the lookup did not run on it.
  if (rawCode && !isValidDtc(rawCode)) {
    return ldError(
      `"${rawCode}" is not a valid DTC. Expected a letter P, B, C or U followed by four digits, e.g. P0420.`,
      400,
    )
  }

  const outcome = await runDiagnosis({
    code:    rawCode,
    issue:   symptom || display,
    display,
    year:    text(body.year),
    make:    text(body.make),
    model:   text(body.model),
    engine:  text(body.engine),
  })

  if (!outcome.ok) return ldError(outcome.message, outcome.status)
  return Response.json(outcome.payload)
}

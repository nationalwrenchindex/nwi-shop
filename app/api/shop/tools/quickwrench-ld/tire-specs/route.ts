// POST /api/shop/tools/quickwrench-ld/tire-specs
// Body: { year, make, model, trim?, engine? }
//
// OEM tire sizes, pressures and lug torque. Requires GEMINI_API_KEY.
//
// The prompt is instructed to return null rather than guess — a wrong lug
// torque puts a wheel on the road — so nulls come back as "not available" in
// the UI and must stay that way.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { generateDiagnostic, geminiNotConfigured, isGeminiConfigured } from '@/lib/gemini'
import {
  AI_DISCLAIMER,
  buildSpecPrompt,
  normalizeTireSpecs,
  parseJsonLoose,
  TIRE_SPECS_SYSTEM_PROMPT,
} from '@/lib/shop/quickwrench/ld'
import { ldError, readJsonBody, text } from '@/lib/shop/quickwrench/ld-http'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { error } = await apiFeature('quickwrench_ld')
  if (error) return error

  if (!isGeminiConfigured()) return geminiNotConfigured()

  const body = await readJsonBody(req)
  if (!body) return ldError('Expected a JSON object body.', 400)

  const year  = text(body.year)
  const make  = text(body.make)
  const model = text(body.model)
  if (!year || !make || !model) return ldError('year, make and model are required.', 400)

  const vehicleDesc = [year, make, model, text(body.trim), text(body.engine)]
    .filter(Boolean)
    .join(' ')

  try {
    const { text: raw, citations } = await generateDiagnostic(
      buildSpecPrompt('tire', vehicleDesc),
      TIRE_SPECS_SYSTEM_PROMPT,
    )
    const parsed = parseJsonLoose(raw)
    if (!parsed) return ldError('Tire specs could not be read from the AI response.', 502)

    return Response.json({
      specs:      normalizeTireSpecs(parsed),
      citations,
      disclaimer: AI_DISCLAIMER,
    })
  } catch (err) {
    console.error('[quickwrench-ld/tire-specs] failed', err)
    return ldError('The tire spec lookup is unavailable right now.', 502)
  }
}

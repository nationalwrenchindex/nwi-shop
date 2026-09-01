// POST /api/shop/tools/quickwrench-ld/fluid-specs
// Body: { year, make, model, engine? }
//
// OEM fluid types. Requires GEMINI_API_KEY. Nulls mean "not confident" and are
// rendered as unavailable — the wrong transmission fluid destroys a
// transmission, so a blank is the safe answer.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { generateDiagnostic, geminiNotConfigured, isGeminiConfigured } from '@/lib/gemini'
import {
  AI_DISCLAIMER,
  buildSpecPrompt,
  FLUID_SPECS_SYSTEM_PROMPT,
  normalizeFluidSpecs,
  parseJsonLoose,
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

  const vehicleDesc = [year, make, model, text(body.engine)].filter(Boolean).join(' ')

  try {
    const { text: raw, citations } = await generateDiagnostic(
      buildSpecPrompt('fluid', vehicleDesc),
      FLUID_SPECS_SYSTEM_PROMPT,
    )
    const parsed = parseJsonLoose(raw)
    if (!parsed) return ldError('Fluid specs could not be read from the AI response.', 502)

    return Response.json({
      specs:      normalizeFluidSpecs(parsed),
      citations,
      disclaimer: AI_DISCLAIMER,
    })
  } catch (err) {
    console.error('[quickwrench-ld/fluid-specs] failed', err)
    return ldError('The fluid spec lookup is unavailable right now.', 502)
  }
}

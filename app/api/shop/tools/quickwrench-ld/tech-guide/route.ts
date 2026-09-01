// POST /api/shop/tools/quickwrench-ld/tech-guide
// Body: { year, make, model, engine?, job }
//
// A vehicle-specific repair guide: steps, torque specs, tools, book hours and a
// parts list. Requires GEMINI_API_KEY.
//
// Ported from NWI Suite's callTechGuideGemini, including its retry: a guide
// that comes back with no parts is the single most common way this call
// degrades (the schema marks parts required, so an empty array is a malformed
// answer). The second attempt is accepted whatever it contains, because some
// jobs genuinely need no parts and failing those outright would be worse.
//
// Unlike the Suite version, no pricing is requested. NWI Shop prices from real
// inventory and the shop's own labor rate — demo prices on a line item a
// customer pays would be indefensible.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { generateDiagnostic, geminiNotConfigured, isGeminiConfigured } from '@/lib/gemini'
import {
  AI_DISCLAIMER,
  buildTechGuidePrompt,
  parseTechGuide,
  TECH_GUIDE_SYSTEM_PROMPT,
  type LdTechGuide,
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
  const job   = text(body.job)
  if (!year || !make || !model) return ldError('year, make and model are required.', 400)
  if (!job) return ldError('`job` is required — name the repair you want a guide for.', 400)

  const vehicleDesc = [year, make, model, text(body.engine)].filter(Boolean).join(' ')
  const prompt = buildTechGuidePrompt(vehicleDesc, job)

  const attempt = async (): Promise<{ guide: LdTechGuide; citations: string[] } | null> => {
    try {
      const { text: raw, citations } = await generateDiagnostic(prompt, TECH_GUIDE_SYSTEM_PROMPT)
      if (!raw) return null
      const guide = parseTechGuide(raw)
      return guide ? { guide, citations } : null
    } catch (err) {
      console.warn('[quickwrench-ld/tech-guide] attempt failed', err)
      return null
    }
  }

  const first = await attempt()
  if (first && first.guide.parts.length > 0) {
    return Response.json({ ...first, disclaimer: AI_DISCLAIMER })
  }

  const second = await attempt()
  const chosen = (second?.guide.parts.length ? second : null) ?? second ?? first

  if (!chosen) {
    return ldError('The repair guide could not be generated. Try again.', 502)
  }

  return Response.json({ ...chosen, disclaimer: AI_DISCLAIMER })
}

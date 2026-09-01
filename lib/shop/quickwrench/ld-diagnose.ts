// SERVER ONLY. The one place a QuickWrench LD diagnostic is actually produced.
// Both POST /diagnose and GET /dtc/[code] funnel through here so a code looked
// up either way gives the same answer from the same cache key.

import { generateDiagnostic } from '@/lib/gemini'
import { readCachedDiagnostic } from './ld-cache'
import {
  buildCodePrompt,
  buildSymptomPrompt,
  DTC_SYSTEM_PROMPT,
  ldCodeCacheKey,
  ldSymptomCacheKey,
  normalizeDiagnostic,
  parseJsonLoose,
  SYMPTOM_SYSTEM_ADDITION,
  vehicleLabel,
  type LdDiagnoseResponse,
  type LdDiagnostic,
} from './ld'

export interface DiagnoseRequest {
  /** A validated DTC (P/B/C/U + 4 digits), or '' for a symptom-only run. */
  code:    string
  /** Free-text symptom or dash message. Required when `code` is ''. */
  issue:   string
  /** Dash text shown alongside a code, if any. */
  display: string
  year:    string
  make:    string
  model:   string
  engine:  string
}

export type DiagnoseOutcome =
  | { ok: true; payload: LdDiagnoseResponse }
  | { ok: false; message: string; status: number }

export async function runDiagnosis(req: DiagnoseRequest): Promise<DiagnoseOutcome> {
  const isCodeMode = req.code !== ''

  if (!isCodeMode && !req.issue) {
    return { ok: false, message: 'Enter a DTC code or describe the issue.', status: 400 }
  }

  const cacheKey = isCodeMode
    ? ldCodeCacheKey(req.code, req.year, req.make, req.model)
    : ldSymptomCacheKey(req.issue, req.year, req.make, req.model)

  // Cache is optional by design — see ld-cache.ts. A failure here is a miss.
  const cached = await readCachedDiagnostic(cacheKey)
  if (cached) {
    return {
      ok: true,
      payload: {
        result: { ...cached, code: isCodeMode ? req.code : cached.code || 'NO-CODE' },
        source: 'cache',
        cached: true,
      },
    }
  }

  const systemPrompt = isCodeMode
    ? DTC_SYSTEM_PROMPT
    : DTC_SYSTEM_PROMPT + SYMPTOM_SYSTEM_ADDITION

  const vehicle = vehicleLabel(req)
  const userPrompt = isCodeMode
    ? buildCodePrompt(req.code, vehicle, req.engine, req.display)
    : buildSymptomPrompt(req.issue, vehicle, req.engine)

  let structured: LdDiagnostic | null = null
  try {
    const raw = await generateDiagnostic(userPrompt, systemPrompt)
    const parsed = parseJsonLoose(raw.text)
    if (parsed) structured = normalizeDiagnostic(parsed, raw.citations)
  } catch (err) {
    console.error('[quickwrench-ld] Gemini failed', err)
  }

  // A structured object with no `name` means the model answered with something
  // that is not a diagnosis. Returning it would put a blank card in front of a
  // tech, which reads as "nothing is wrong" — refuse instead.
  if (!structured || !structured.name) {
    return {
      ok: false,
      message: 'The diagnostic could not be generated. Try again, or add the engine and dash message for more context.',
      status: 502,
    }
  }

  structured.code = isCodeMode ? req.code : 'NO-CODE'

  // NOTE: no cache write. hd_cached_diagnostics belongs to NWI Suite and NWI
  // Shop never writes to an hd_* table.
  return { ok: true, payload: { result: structured, source: 'gemini_web_search', cached: false } }
}

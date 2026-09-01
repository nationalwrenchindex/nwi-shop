// POST /api/shop/tools/quickwrench-hd/gauge
//
// Manifold-gauge pressure diagnostic. Pure computation — no model call, no
// database read, no network. It answers identically whether or not any API key
// is configured, which is why it is the one panel the UI can promise always
// works.
//
// The engine is a verbatim port of NWI Suite's gauge-diagnostic module; see
// lib/shop/quickwrench/hd-gauge.ts.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { apiError, asNumber, readJsonBody } from '@/lib/shop/jobs'
import { runGaugeDiagnostic, SEVERITY_CONFIG } from '@/lib/shop/quickwrench/hd-gauge'

/** Optional bounds: accepted when present, ignored when not a finite number. */
function optionalNumber(value: unknown): number | undefined {
  const n = asNumber(value)
  return n === null ? undefined : n
}

export async function POST(req: NextRequest) {
  const { error } = await apiFeature('quickwrench_hd')
  if (error) return error

  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const actualSuction   = asNumber(body.actualSuction)
  const actualDischarge = asNumber(body.actualDischarge)

  if (actualSuction === null || actualDischarge === null) {
    return apiError('`actualSuction` and `actualDischarge` are required numbers (PSI).', 400)
  }
  // Guard rails, not diagnosis: a reading this far outside physical range is a
  // typo, and running the matrix on it would return a confident wrong pattern.
  if (actualSuction < -30 || actualSuction > 400) {
    return apiError('`actualSuction` is outside a plausible range (-30 to 400 PSI).', 400)
  }
  if (actualDischarge < 0 || actualDischarge > 800) {
    return apiError('`actualDischarge` is outside a plausible range (0 to 800 PSI).', 400)
  }

  const result = runGaugeDiagnostic({
    actualSuction,
    actualDischarge,
    suctionLow:    optionalNumber(body.suctionLow),
    suctionHigh:   optionalNumber(body.suctionHigh),
    dischargeLow:  optionalNumber(body.dischargeLow),
    dischargeHigh: optionalNumber(body.dischargeHigh),
    ambientTemp:   optionalNumber(body.ambientTemp),
    boxTemp:       optionalNumber(body.boxTemp),
  })

  const severity = result.pattern ? SEVERITY_CONFIG[result.pattern.severity] : null

  return Response.json({
    ...result,
    severity,
    readings: { actualSuction, actualDischarge },
    // Only ever surfaced when the matrix found nothing — an honest "no match" is
    // better than the nearest pattern.
    unmatched: result.pattern === null,
    aiUsed: false,
  })
}

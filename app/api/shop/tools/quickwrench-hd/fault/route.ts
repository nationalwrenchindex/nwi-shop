// GET /api/shop/tools/quickwrench-hd/fault?spn=3251&fmi=0
//
// J1939 fault-code decode. This route does NOT call a model: the SPN and FMI
// tables in lib/shop/quickwrench/hd-j1939.ts are field-authored data lifted from
// NWI Suite's diagnostic corpus, so a tech standing at a truck gets the fault
// meaning and the failure mode with no API key of any kind. The AI enrichment is
// a separate, explicit step through /diagnose.
//
// When an SPN is not in the table we say so and point at OEM software. We never
// invent an SPN definition — a made-up fault meaning sends a tech to the wrong
// system on a truck that is already down.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { apiError } from '@/lib/shop/jobs'
import { fmiFieldRule, lookupFmi, lookupSpn } from '@/lib/shop/quickwrench/hd-j1939'
import { TRUCK_DISCLAIMER } from '@/lib/shop/quickwrench/hd-prompts'
import { hdEngineStatus } from '@/lib/shop/quickwrench/hd'

function parseCode(value: string | null): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^\d{1,6}$/.test(trimmed)) return null
  const n = Number.parseInt(trimmed, 10)
  return Number.isFinite(n) ? n : null
}

export async function GET(req: NextRequest) {
  const { error } = await apiFeature('quickwrench_hd')
  if (error) return error

  const params = req.nextUrl.searchParams
  const spnRaw = params.get('spn')
  const fmiRaw = params.get('fmi')

  if (!spnRaw && !fmiRaw) {
    return apiError('Give an `spn`, an `fmi`, or both.', 400)
  }

  const spn = parseCode(spnRaw)
  const fmi = parseCode(fmiRaw)

  if (spnRaw && spn === null) return apiError('`spn` must be a number.', 400)
  if (fmiRaw && fmi === null) return apiError('`fmi` must be a number.', 400)

  const spnEntry = spn === null ? null : lookupSpn(spn)
  const fmiEntry = fmi === null ? null : lookupFmi(fmi)

  const unknown: string[] = []
  if (spn !== null && !spnEntry) {
    unknown.push(
      `SPN ${spn} is not in the offline reference. Read it with OEM software — Cummins Insite, Detroit DiagnosticLink or Mercedes-Benz Xentry — or run a full diagnostic for a researched answer.`,
    )
  }
  if (fmi !== null && !fmiEntry) {
    unknown.push(`FMI ${fmi} is not a standard J1939 failure mode identifier. Re-read the code — J1939 FMIs run 0-19 and 31.`)
  }

  return Response.json({
    spn:        spnEntry,
    fmi:        fmiEntry,
    fieldRule:  fmi === null ? null : fmiFieldRule(fmi),
    unknown,
    label:      [spn !== null ? `SPN ${spn}` : null, fmi !== null ? `FMI ${fmi}` : null]
      .filter(Boolean).join(' '),
    disclaimer: TRUCK_DISCLAIMER,
    // No AI was used here. The client shows the engine status so the tech knows
    // whether the "run full diagnostic" follow-up is going to reach a model.
    engine:     hdEngineStatus(),
    aiUsed:     false,
  })
}

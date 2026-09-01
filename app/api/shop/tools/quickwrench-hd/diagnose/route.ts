// POST /api/shop/tools/quickwrench-hd/diagnose
//
// The AI path: a symptom, a fault code, or a plain electrical question goes in,
// a structured diagnostic comes back with whatever grounding citations the
// engine could supply.
//
// Engine order is cache → Gemini (grounded) → Anthropic (ungrounded). In this
// deployment GEMINI_API_KEY is unset and ANTHROPIC_API_KEY is set, so the
// Anthropic path is the one that answers — see the header of lib/shop/
// quickwrench/hd.ts. When neither key is present the route still returns 200
// with `usable: false` and Suite's canned "consult OEM software" text, so the
// tech gets a clear instruction rather than a spinner and a 503.
//
// The cache is NWI Suite's `hd_cached_diagnostics`. We read it and never write
// it — see lib/shop/quickwrench/hd-reference.ts.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, asText, readJsonBody } from '@/lib/shop/jobs'
import {
  AI_VERIFY_NOTICE,
  hdEngineStatus,
  runHdDiagnostic,
  toJobNote,
  type HdDiagnosticInput,
} from '@/lib/shop/quickwrench/hd'
import {
  lookupParts,
  lookupReeferAlarm,
  readCachedDiagnostic,
  reeferCacheKey,
  truckCacheKey,
  type HdPart,
} from '@/lib/shop/quickwrench/hd-reference'

export const maxDuration = 60

/** Alarm code → parts category, for the reefer branch. Ported from NWI Suite. */
const TK_CODE_CATEGORIES: Record<string, string[]> = {
  '17': ['starter'],
  '20': ['starter', 'fuel_pump', 'solenoid', 'glow_plug'],
  '15': ['glow_plug'],
  '25': ['alternator', 'belt'],
  '51': ['alternator', 'belt'],
  '10': ['belt', 'compressor'],
  '46': ['belt', 'filter'],
  '48': ['belt'],
  '40': ['solenoid'],
  '31': ['solenoid'],
  '32': ['solenoid'],
  '35': ['solenoid'],
  '18': ['thermostat', 'water_pump'],
  '41': ['sensor'],
  '12': ['sensor'],
  '37': ['sensor'],
  '19': ['switch'],
  '11': ['filter'],
}

function categoriesForCode(code: string): string[] {
  const normalized = /^\d+$/.test(code.trim()) ? String(parseInt(code, 10)) : code.trim()
  return TK_CODE_CATEGORIES[normalized] ?? TK_CODE_CATEGORIES[code.trim()] ?? []
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await apiFeature('quickwrench_hd')
  if (error) return error

  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const domain = asText(body.domain) ?? 'truck'
  if (domain !== 'truck' && domain !== 'reefer' && domain !== 'electrical') {
    return apiError('`domain` must be "truck", "reefer" or "electrical".', 400)
  }

  const supabase = await createClient()
  let input: HdDiagnosticInput
  let cacheKey = ''
  let heading = ''
  let parts: HdPart[] = []

  if (domain === 'truck') {
    const truckBrand  = asText(body.truckBrand)
    const engineModel = asText(body.engineModel)
    if (!truckBrand || !engineModel) {
      return apiError('`truckBrand` and `engineModel` are required.', 400)
    }
    const spn     = asText(body.spn) ?? undefined
    const fmi     = asText(body.fmi) ?? undefined
    const symptom = asText(body.symptom) ?? undefined
    if (!spn && !fmi && !symptom) {
      return apiError('Give an SPN, an FMI, or a symptom.', 400)
    }

    const vehicleYear   = asText(body.vehicleYear) ?? undefined
    const vehicleMake   = asText(body.vehicleMake) ?? undefined
    const vehicleModel  = asText(body.vehicleModel) ?? undefined
    const vehicleEngine = asText(body.vehicleEngine) ?? undefined

    input = {
      domain: 'truck',
      truckBrand, engineModel, spn, fmi, symptom,
      vehicleYear, vehicleMake, vehicleModel, vehicleEngine,
    }
    heading = [truckBrand, engineModel, spn && `SPN ${spn}`, fmi && `FMI ${fmi}`]
      .filter(Boolean).join(' ')

    // Only cache-key a query whose answer is a pure function of the key. A
    // free-text symptom or a specific vehicle makes the answer vary beyond the
    // key, so a hit there could hand back a wrong-vehicle result.
    const vehicleSpecific = Boolean(vehicleYear || vehicleMake || vehicleModel || vehicleEngine)
    if ((spn || fmi) && !symptom && !vehicleSpecific) {
      cacheKey = truckCacheKey(truckBrand, engineModel, spn ?? '', fmi ?? '')
    }
  } else if (domain === 'reefer') {
    const manufacturer = asText(body.manufacturer)
    const model        = asText(body.model)
    if (!manufacturer || !model) {
      return apiError('`manufacturer` and `model` are required.', 400)
    }
    const alarmCode = asText(body.alarmCode) ?? undefined
    const symptom   = asText(body.symptom) ?? undefined
    if (!alarmCode && !symptom) {
      return apiError('Give an alarm code or a symptom.', 400)
    }

    // Alarm-code definitions are owned by the reefer alarm-codes tool. Ask it,
    // and carry on without a definition if it is not deployed or does not know.
    let alarmDefinition: string | undefined
    if (alarmCode) {
      const definition = await lookupReeferAlarm(
        req.nextUrl.origin,
        alarmCode,
        manufacturer,
        req.headers.get('cookie') ?? '',
      )
      if (definition) {
        alarmDefinition = [
          `Code ${definition.code}: ${definition.description}`,
          definition.severity ? `Severity: ${definition.severity}` : null,
          definition.operatorAction ? `Operator Action: ${definition.operatorAction}` : null,
        ].filter(Boolean).join(' | ')
      }

      const categories = categoriesForCode(alarmCode)
      if (categories.length > 0) {
        const found = await Promise.all(
          categories.map((category) =>
            lookupParts(supabase, { manufacturer, category, unitModel: model, limit: 6 }),
          ),
        )
        const seen = new Set<string>()
        parts = found.flat().filter((p) => {
          if (seen.has(p.part_number)) return false
          seen.add(p.part_number)
          return true
        }).slice(0, 12)
      }
    }

    input = {
      domain: 'reefer',
      manufacturer, model,
      unitType:       asText(body.unitType) ?? undefined,
      alarmCode, symptom,
      serialNumber:   asText(body.serialNumber) ?? undefined,
      displayMessage: asText(body.displayMessage) ?? undefined,
      alarmDefinition,
    }
    heading = [manufacturer, model, alarmCode && `Alarm ${alarmCode}`].filter(Boolean).join(' ')

    if (alarmCode && !symptom) cacheKey = reeferCacheKey(manufacturer, model, alarmCode)
  } else {
    const question = asText(body.question)
    if (!question) return apiError('`question` is required.', 400)
    input = { domain: 'electrical', topic: asText(body.topic) ?? undefined, question }
    heading = 'HD electrical'
  }

  const cachedRow = cacheKey ? await readCachedDiagnostic(supabase, cacheKey) : null

  const result = await runHdDiagnostic(input, {
    cached: cachedRow
      ? { text: cachedRow.result_html, citations: cachedRow.citations ?? [] }
      : null,
    parts,
  })

  return Response.json({
    ...result,
    heading,
    parts,
    engine: hdEngineStatus(),
    notice: AI_VERIFY_NOTICE,
    shopType: ctx.shopType,
    // Pre-built so "attach to job" writes the same provenance every time: which
    // engine answered, the verification notice, and the disclaimer.
    note: toJobNote(result, heading),
  })
}

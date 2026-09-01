// GET  /api/shop/inspections — the compliance list. DOT and aerial come out of
//                              one table, so one endpoint serves both; `?type=`
//                              narrows it and the shop's features decide what it
//                              is allowed to see.
// POST /api/shop/inspections — create a signed inspection.
//
// THREE THINGS THIS ROUTE DOES THAT NWI SUITE'S DID NOT:
//
//  1. It gates aerial writes. Suite's POST /api/hd/aerial-inspections checked
//     getUser() and nothing else — any signed-in account could write aerial
//     compliance records regardless of shop type or plan.
//  2. It requires a signature. Suite's DOT route stored
//     `signature_data: body.signature_data ?? null` while its own client demanded
//     one, and its PDF then printed "UNSIGNED". A signed compliance document that
//     can be created unsigned is a defect, not a feature.
//  3. It re-derives `result` and `deficiencies` from the raw items. Suite's
//     aerial route did this; its DOT route took `overall_result` from whatever
//     the browser sent.

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, asNumber, asText, readJsonBody } from '@/lib/shop/jobs'
import {
  allowedInspectionTypes,
  canUseInspectionType,
  inspectionFeatureMessage,
} from '@/lib/shop/inspections/access'
import {
  deriveInspection,
  formFor,
  isValidSignature,
  parseAnswers,
} from '@/lib/shop/inspections/result'
import {
  isAerialCadence,
  isInspectionType,
  type ShopInspection,
} from '@/lib/shop/inspections/types'
import type { ShopTech } from '@/lib/types'

const MAX_ROWS = 200

export async function GET(request: NextRequest) {
  const { ctx, error } = await apiContext()
  if (error) return error

  // apiFeature() gates one feature and this endpoint serves two, so the gate is
  // applied per row type instead: the shop sees exactly the families it has.
  const allowed = allowedInspectionTypes(ctx)
  if (allowed.length === 0) {
    return apiError('Inspections are not included for your shop.', 403)
  }

  const url = new URL(request.url)
  const typeParam = url.searchParams.get('type')
  if (typeParam !== null && !isInspectionType(typeParam)) {
    return apiError('type must be "dot" or "aerial".', 400)
  }
  if (typeParam && !canUseInspectionType(ctx, typeParam)) {
    return apiError(inspectionFeatureMessage(ctx, typeParam), 403)
  }

  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const vehicleId = url.searchParams.get('vehicle_id')
  const jobId = url.searchParams.get('job_id')
  const limitParam = Number(url.searchParams.get('limit'))
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_ROWS) : 100

  const supabase = await createClient()

  let query = supabase
    .from('shop_inspections')
    .select('*')
    .eq('shop_id', ctx.shop.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  query = typeParam ? query.eq('type', typeParam) : query.in('type', allowed)
  if (from) query = query.gte('created_at', from)
  // `to` arrives as a plain date; include the whole day.
  if (to) query = query.lte('created_at', `${to}T23:59:59.999Z`)
  if (vehicleId) query = query.eq('vehicle_id', vehicleId)
  if (jobId) query = query.eq('job_id', jobId)

  const { data, error: dbError } = await query.returns<ShopInspection[]>()

  // Degrade rather than 500: migration 009 may not have been applied yet, and an
  // empty list with a notice is a better answer than a broken screen.
  if (dbError) {
    return Response.json({ inspections: [], warning: dbError.message }, { status: 200 })
  }

  return Response.json({ inspections: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await apiContext()
  if (error) return error

  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  // ── which form ────────────────────────────────────────────────────────────
  const type = body.type
  if (!isInspectionType(type)) {
    return apiError('type must be "dot" or "aerial".', 400)
  }
  if (!canUseInspectionType(ctx, type)) {
    return apiError(inspectionFeatureMessage(ctx, type), 403)
  }

  const cadence = type === 'aerial' ? body.cadence : null
  if (type === 'aerial' && !isAerialCadence(cadence)) {
    return apiError('An aerial inspection needs a cadence: pre_use, frequent or annual.', 400)
  }

  const def = formFor(type, isAerialCadence(cadence) ? cadence : null)
  if (!def) return apiError('Unknown inspection form.', 400)

  // ── the verdict, derived here and never read from the body ─────────────────
  const answers = parseAnswers(def, body.items)
  const derived = deriveInspection(def, answers)

  if (derived.unanswered > 0) {
    return apiError(
      `${derived.unanswered} item${derived.unanswered === 1 ? ' is' : 's are'} unanswered. ` +
        'Every line needs Pass, Fail or N/A before the inspection can be signed.',
      400,
    )
  }

  // A signature is what makes this a certification rather than a note. Required,
  // server-side, for both families.
  const signature = body.signature_data
  if (!isValidSignature(signature)) {
    return apiError('A signature is required to file an inspection.', 400)
  }

  const removedFromService = body.removed_from_service === true
  if (derived.critical && !removedFromService) {
    return apiError(
      'This inspection has a safety-critical failure. The unit must be marked ' +
        'removed from service before the record can be filed.',
      400,
    )
  }

  // ── who signed ────────────────────────────────────────────────────────────
  // A tech signs as themselves. Staff may file an inspection performed by
  // another tech — a paper inspection typed in later is the normal case — and
  // the printed name then comes from that tech's row, never from free text, so
  // nobody's name reaches a signed document without their record behind it.
  const supabase = await createClient()

  let inspector: Pick<ShopTech, 'id' | 'first_name' | 'last_name'> = ctx.tech
  const requestedTechId = asText(body.inspector_tech_id)
  if (requestedTechId && requestedTechId !== ctx.tech.id) {
    if (!ctx.permissions.viewAllJobs) {
      return apiError('You can only file an inspection under your own name.', 403)
    }
    const { data: other } = await supabase
      .from('shop_techs')
      .select('id, first_name, last_name')
      .eq('id', requestedTechId)
      .eq('shop_id', ctx.shop.id)
      .maybeSingle<Pick<ShopTech, 'id' | 'first_name' | 'last_name'>>()
    if (!other) return apiError('That inspector is not on your team.', 400)
    inspector = other
  }

  const inspectorName = `${inspector.first_name} ${inspector.last_name}`.trim()
  if (!inspectorName) return apiError('The inspector has no name on file.', 400)

  // ── links, each verified to belong to this shop ────────────────────────────
  const jobId = asText(body.job_id)
  const vehicleId = asText(body.vehicle_id)
  const customerId = asText(body.customer_id)

  if (jobId && !(await belongsToShop(supabase, 'shop_jobs', jobId, ctx.shop.id))) {
    return apiError('That work order is not in your shop.', 400)
  }
  if (vehicleId && !(await belongsToShop(supabase, 'shop_vehicles', vehicleId, ctx.shop.id))) {
    return apiError('That vehicle is not in your shop.', 400)
  }
  if (customerId && !(await belongsToShop(supabase, 'shop_customers', customerId, ctx.shop.id))) {
    return apiError('That customer is not in your shop.', 400)
  }

  // ── signed_at and locked_at are different facts ────────────────────────────
  // signed_at is when a human put their name to the result — the date on the
  // certificate. locked_at is when this row stopped being editable, a fact about
  // our software. They differ for a paper inspection typed in on Monday, which
  // is exactly the case NWI Suite gets wrong by storing one timestamp for both.
  const now = new Date()
  const signedAt = parseSignedAt(body.signed_at, now)
  if (signedAt === null) {
    return apiError('signed_at must be a valid date that is not in the future.', 400)
  }

  const { data: inspection, error: insertError } = await supabase
    .from('shop_inspections')
    .insert({
      shop_id:               ctx.shop.id,
      type,
      cadence:               isAerialCadence(cadence) ? cadence : null,
      job_id:                jobId,
      vehicle_id:            vehicleId,
      customer_id:           customerId,
      unit_number:           asText(body.unit_number),
      inspector_tech_id:     inspector.id,
      inspector_name:        inspectorName,
      inspector_cert_number: asText(body.inspector_cert_number),
      result:                derived.result,
      items:                 derived.items,
      deficiencies:          derived.deficiencies,
      violations:            derived.violations,
      removed_from_service:  removedFromService,
      carrier_name:          asText(body.carrier_name),
      carrier_address:       asText(body.carrier_address),
      license_plate:         asText(body.license_plate),
      odometer:              odometerOf(body.odometer),
      signature_data:        signature,
      signed_at:             signedAt,
      locked:                true,
      locked_at:             now.toISOString(),
    })
    .select('*')
    .maybeSingle<ShopInspection>()

  if (insertError || !inspection) {
    // The one policy this route cannot pre-check is shop_job_visible(job_id):
    // a tech may only attach paperwork to a work order on their own board, and
    // "visible" is defined in SQL. Translate the policy violation rather than
    // showing a tech a Postgres error string.
    if (insertError && /row-level security/i.test(insertError.message)) {
      return apiError(
        'That work order is not on your board, so an inspection cannot be filed against it.',
        403,
      )
    }
    return apiError(insertError?.message ?? 'Could not file the inspection.', 400)
  }

  return Response.json({ inspection }, { status: 201 })
}

/** Confirms a linked row is in the caller's shop before it is written onto a record. */
async function belongsToShop(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: 'shop_jobs' | 'shop_vehicles' | 'shop_customers',
  id: string,
  shopId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('shop_id', shopId)
    .maybeSingle<{ id: string }>()
  return data !== null
}

function odometerOf(value: unknown): number | null {
  const parsed = asNumber(value)
  if (parsed === null || parsed < 0) return null
  return Math.round(parsed)
}

/**
 * Accepts a full ISO timestamp or a plain `YYYY-MM-DD`. A date-only value is
 * read at noon so it cannot slip a day across a timezone, and is clamped to
 * `now` when that noon has not happened yet — signing a form at 9am should not
 * stamp the certificate for lunchtime. Returns null when the value is unusable
 * or genuinely in the future; falls back to `now` when nothing was sent.
 */
function parseSignedAt(value: unknown, now: Date): string | null {
  const raw = asText(value)
  if (!raw) return now.toISOString()

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw)
  const parsed = new Date(dateOnly ? `${raw}T12:00:00` : raw)
  if (Number.isNaN(parsed.getTime())) return null

  if (dateOnly) {
    if (raw > localDay(now)) return null
    return parsed.getTime() > now.getTime() ? now.toISOString() : parsed.toISOString()
  }
  // A little skew for a tablet clock that is a few minutes ahead.
  if (parsed.getTime() > now.getTime() + 10 * 60 * 1000) return null
  return parsed.toISOString()
}

/** `YYYY-MM-DD` in server-local time, to compare against a date-only input. */
function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

// GET  /api/shop/epa — the refrigerant log, by date range and optionally by job.
// POST /api/shop/epa — write an entry.
//
// THE POST IS THE POINT. NWI Suite's /hd/epa-log had no create path anywhere in
// the product: its "+ Log Entry" button opened a panel that read "Full EPA log
// entry form coming in the next update", and rows could only be inserted by hand
// in the database. A compliance log nobody can write is not a compliance log.
//
// Suite's page also had no tier gate at all — any signed-in account reached it.
// Both verbs here run through apiFeature('epa_608'), which applies the shop-type
// and tier gates together.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, asNumber, asText, readJsonBody } from '@/lib/shop/jobs'
import {
  isEpaAction,
  isValidLogDate,
  isValidPounds,
  normaliseRefrigerant,
  toDateInput,
  type ShopEpaLogEntry,
} from '@/lib/shop/epa'
import type { ShopTech } from '@/lib/types'

const MAX_ROWS = 500

export async function GET(request: NextRequest) {
  const { ctx, error } = await apiFeature('epa_608')
  if (error) return error

  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const jobId = url.searchParams.get('job_id')
  const vehicleId = url.searchParams.get('vehicle_id')
  const limitParam = Number(url.searchParams.get('limit'))
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_ROWS) : 200

  const supabase = await createClient()

  let query = supabase
    .from('shop_epa_log')
    .select('*')
    .eq('shop_id', ctx.shop.id)
    .order('log_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  // Managers and foremen run the shop's totals; a tech sees the entries they
  // signed. Same discriminator the rest of the app uses for "my work" vs "the
  // shop's work" — RLS permits the whole shop either way, this is the product
  // rule on top of it.
  if (!ctx.permissions.viewAllJobs) query = query.eq('tech_id', ctx.tech.id)

  if (from) query = query.gte('log_date', from)
  if (to) query = query.lte('log_date', to)
  if (jobId) query = query.eq('job_id', jobId)
  if (vehicleId) query = query.eq('vehicle_id', vehicleId)

  const { data, error: dbError } = await query.returns<ShopEpaLogEntry[]>()

  // Degrade rather than 500 — migration 010 is applied by hand and may not have
  // been run yet.
  if (dbError) {
    return Response.json({ entries: [], warning: dbError.message }, { status: 200 })
  }

  return Response.json({ entries: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await apiFeature('epa_608')
  if (error) return error

  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const action = body.action
  if (!isEpaAction(action)) {
    return apiError('action must be added, recovered, evacuated or leak_test.', 400)
  }

  const refrigerantRaw = asText(body.refrigerant_type)
  if (!refrigerantRaw) return apiError('A refrigerant type is required.', 400)
  const refrigerantType = normaliseRefrigerant(refrigerantRaw)

  const pounds = asNumber(body.pounds) ?? 0
  if (!isValidPounds(pounds)) {
    return apiError('Pounds must be zero or more.', 400)
  }
  // `action` carries the direction, so a signed amount would record it twice and
  // let the two disagree. A recovery of 4 lbs is action=recovered, pounds=4.
  if (action !== 'leak_test' && pounds === 0) {
    return apiError(`A ${action.replace('_', ' ')} entry needs an amount in pounds.`, 400)
  }

  const logDate = asText(body.log_date) ?? toDateInput(new Date())
  if (!isValidLogDate(logDate)) {
    return apiError('log_date must be a real date that is not in the future.', 400)
  }

  const supabase = await createClient()

  // A tech logs under their own id — RLS enforces it, and this produces the
  // clear message instead of a policy violation. Staff may log on behalf of the
  // tech who did the work.
  let techId = ctx.tech.id
  const requestedTechId = asText(body.tech_id)
  if (requestedTechId && requestedTechId !== ctx.tech.id) {
    if (!ctx.permissions.viewAllJobs) {
      return apiError('You can only log refrigerant under your own name.', 403)
    }
    const { data: other } = await supabase
      .from('shop_techs')
      .select('id')
      .eq('id', requestedTechId)
      .eq('shop_id', ctx.shop.id)
      .maybeSingle<Pick<ShopTech, 'id'>>()
    if (!other) return apiError('That technician is not on your team.', 400)
    techId = other.id
  }

  const jobId = asText(body.job_id)
  const vehicleId = asText(body.vehicle_id)

  if (jobId) {
    const { data: job } = await supabase
      .from('shop_jobs')
      .select('id')
      .eq('id', jobId)
      .eq('shop_id', ctx.shop.id)
      .maybeSingle<{ id: string }>()
    if (!job) return apiError('That work order is not in your shop.', 400)
  }
  if (vehicleId) {
    const { data: vehicle } = await supabase
      .from('shop_vehicles')
      .select('id')
      .eq('id', vehicleId)
      .eq('shop_id', ctx.shop.id)
      .maybeSingle<{ id: string }>()
    if (!vehicle) return apiError('That vehicle is not in your shop.', 400)
  }

  const { data: entry, error: insertError } = await supabase
    .from('shop_epa_log')
    .insert({
      shop_id:                   ctx.shop.id,
      job_id:                    jobId,
      vehicle_id:                vehicleId,
      tech_id:                   techId,
      log_date:                  logDate,
      refrigerant_type:          refrigerantType,
      action,
      pounds,
      reason:                    asText(body.reason),
      // The number belongs to the person, not to the shop, so it is copied onto
      // the row: the tech can leave and the log still names a certified
      // individual.
      tech_certification_number: asText(body.tech_certification_number),
      notes:                     asText(body.notes),
    })
    .select('*')
    .maybeSingle<ShopEpaLogEntry>()

  if (insertError || !entry) {
    // shop_job_visible(job_id) is the one policy this route cannot pre-check —
    // a tech may only log against a work order on their own board, and
    // "visible" is defined in SQL.
    if (insertError && /row-level security/i.test(insertError.message)) {
      return apiError(
        'That work order is not on your board, so refrigerant cannot be logged against it.',
        403,
      )
    }
    return apiError(insertError?.message ?? 'Could not save the log entry.', 400)
  }

  return Response.json({ entry }, { status: 201 })
}

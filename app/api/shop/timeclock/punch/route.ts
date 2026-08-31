// POST /api/shop/timeclock/punch
//
// The single write path for the clock. Body:
//   { action: 'in' | 'out', type: 'shop' | 'job', job_id?: string, tech_id?: string }
//
// `tech_id` is ignored unless the caller holds `runPayroll` — a tech may only
// ever punch themselves. Every read and write is pinned to the caller's shop.

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { minutesBetween } from '@/lib/shop/timeclock'
import type { PunchResult } from '@/lib/shop/timeclock'
import type { PunchType, ShopJob, ShopTech, ShopTimeclock } from '@/lib/types'
import type { ServerClient } from '../_queries'

/** Postgres unique-violation — the partial index that keeps one punch open. */
const UNIQUE_VIOLATION = '23505'

interface PunchBody {
  action?: unknown
  type?: unknown
  job_id?: unknown
  tech_id?: unknown
}

function bad(message: string, status = 400): Response {
  return Response.json({ error: message }, { status })
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Closes one open punch, stamping `total_minutes`. Returns the updated row. */
async function closePunch(
  supabase: ServerClient,
  punch: ShopTimeclock,
  shopId: string,
  nowIso: string,
): Promise<{ row: ShopTimeclock | null; failed: boolean }> {
  const { data, error } = await supabase
    .from('shop_timeclock')
    .update({
      punch_out: nowIso,
      total_minutes: minutesBetween(punch.punch_in, nowIso),
    })
    .eq('id', punch.id)
    .eq('shop_id', shopId)
    .eq('tech_id', punch.tech_id)
    .is('punch_out', null)
    .select('*')
    .maybeSingle<ShopTimeclock>()

  if (error) return { row: null, failed: true }
  return { row: data ?? null, failed: false }
}

/**
 * Undoes a `closePunch` when the insert that was supposed to follow it failed.
 * Without this a job swap could half-apply: old punch closed, new one missing.
 */
async function reopenPunch(
  supabase: ServerClient,
  punchId: string,
  shopId: string,
): Promise<void> {
  await supabase
    .from('shop_timeclock')
    .update({ punch_out: null, total_minutes: null })
    .eq('id', punchId)
    .eq('shop_id', shopId)
}

async function findOpen(
  supabase: ServerClient,
  shopId: string,
  techId: string,
  type: PunchType,
): Promise<ShopTimeclock | null> {
  const { data } = await supabase
    .from('shop_timeclock')
    .select('*')
    .eq('shop_id', shopId)
    .eq('tech_id', techId)
    .eq('type', type)
    .is('punch_out', null)
    .order('punch_in', { ascending: false })
    .limit(1)
    .returns<ShopTimeclock[]>()

  return data?.[0] ?? null
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await apiContext()
  if (!auth.ctx) return auth.error
  const ctx = auth.ctx

  let body: PunchBody
  try {
    body = (await request.json()) as PunchBody
  } catch {
    return bad('Malformed request body.')
  }

  const action = body.action === 'in' || body.action === 'out' ? body.action : null
  const type: PunchType | null =
    body.type === 'shop' || body.type === 'job' ? body.type : null

  if (!action) return bad("`action` must be 'in' or 'out'.")
  if (!type) return bad("`type` must be 'shop' or 'job'.")

  const supabase = await createClient()
  const shopId = ctx.shop.id
  const now = new Date()
  const nowIso = now.toISOString()

  // --- who is being punched -------------------------------------------------
  // A tech may punch only themselves. The override is silently dropped rather
  // than rejected for callers without `runPayroll`.
  let techId = ctx.tech.id
  const requested = asString(body.tech_id)
  if (requested && requested !== ctx.tech.id && ctx.permissions.runPayroll) {
    const { data: target } = await supabase
      .from('shop_techs')
      .select('*')
      .eq('id', requested)
      .eq('shop_id', shopId)
      .eq('active', true)
      .maybeSingle<ShopTech>()

    if (!target) return bad('That tech is not on this shop roster.', 404)
    techId = target.id
  }

  const jobId = asString(body.job_id)

  // -------------------------------------------------------------------------
  // Punch OUT
  // -------------------------------------------------------------------------
  if (action === 'out') {
    const open = await findOpen(supabase, shopId, techId, type)
    if (!open) {
      return bad(
        type === 'shop' ? 'Not on the shop clock.' : 'Not punched into a job.',
        409,
      )
    }

    const closed: ShopTimeclock[] = []

    // Leaving for the day closes any job still running, so a job punch can
    // never keep counting after the tech has gone home.
    if (type === 'shop') {
      const openJob = await findOpen(supabase, shopId, techId, 'job')
      if (openJob) {
        const result = await closePunch(supabase, openJob, shopId, nowIso)
        if (result.row) closed.push(result.row)
      }
    }

    const result = await closePunch(supabase, open, shopId, nowIso)
    if (result.failed) return bad('Could not record the punch out. Try again.', 500)
    if (result.row) closed.push(result.row)

    const payload: PunchResult = {
      ok: true,
      punch: result.row,
      closed,
      message: type === 'shop' ? 'Punched out for the day.' : 'Punched off the job.',
    }
    return Response.json(payload)
  }

  // -------------------------------------------------------------------------
  // Punch IN — shop
  // -------------------------------------------------------------------------
  if (type === 'shop') {
    const alreadyOpen = await findOpen(supabase, shopId, techId, 'shop')
    if (alreadyOpen) return bad('Already on the shop clock.', 409)

    const { data, error } = await supabase
      .from('shop_timeclock')
      .insert({
        shop_id: shopId,
        tech_id: techId,
        job_id: null,
        type: 'shop',
        punch_in: nowIso,
      })
      .select('*')
      .maybeSingle<ShopTimeclock>()

    if (error) {
      return bad(
        error.code === UNIQUE_VIOLATION
          ? 'Already on the shop clock.'
          : 'Could not record the punch in. Try again.',
        error.code === UNIQUE_VIOLATION ? 409 : 500,
      )
    }

    const payload: PunchResult = {
      ok: true,
      punch: data ?? null,
      closed: [],
      message: 'Punched in at the shop.',
    }
    return Response.json(payload)
  }

  // -------------------------------------------------------------------------
  // Punch IN — job (closes any other open job punch first)
  // -------------------------------------------------------------------------
  if (!jobId) return bad('`job_id` is required to punch into a job.')

  const { data: job } = await supabase
    .from('shop_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('shop_id', shopId)
    .maybeSingle<ShopJob>()

  if (!job) return bad('That job is not on this shop board.', 404)
  if (job.voided) return bad('That job has been voided.', 409)

  // A tech without `viewAllJobs` may only book time to their own work.
  if (!ctx.permissions.viewAllJobs && job.assigned_tech_id !== techId) {
    return bad('That job is not assigned to you.', 403)
  }

  const openJob = await findOpen(supabase, shopId, techId, 'job')
  if (openJob && openJob.job_id === jobId) {
    return bad(`Already punched into job #${job.job_number}.`, 409)
  }

  const closed: ShopTimeclock[] = []
  if (openJob) {
    const result = await closePunch(supabase, openJob, shopId, nowIso)
    if (result.failed || !result.row) {
      return bad('Could not close the previous job punch. Nothing was changed.', 500)
    }
    closed.push(result.row)
  }

  const { data: inserted, error: insertError } = await supabase
    .from('shop_timeclock')
    .insert({
      shop_id: shopId,
      tech_id: techId,
      job_id: jobId,
      type: 'job',
      punch_in: nowIso,
    })
    .select('*')
    .maybeSingle<ShopTimeclock>()

  if (insertError || !inserted) {
    // Roll the swap back so the tech is left on the job they were already on.
    if (openJob) await reopenPunch(supabase, openJob.id, shopId)
    return bad(
      insertError?.code === UNIQUE_VIOLATION
        ? 'Already punched into another job.'
        : 'Could not punch into that job. Nothing was changed.',
      insertError?.code === UNIQUE_VIOLATION ? 409 : 500,
    )
  }

  const payload: PunchResult = {
    ok: true,
    punch: inserted,
    closed,
    message: closed.length
      ? `Moved to job #${job.job_number}.`
      : `Punched into job #${job.job_number}.`,
  }
  return Response.json(payload)
}

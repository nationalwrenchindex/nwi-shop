// Shared server-side query helpers for the timeclock routes. SERVER ONLY —
// never import from a client component. All time math lives in
// `@/lib/shop/timeclock`; this file only talks to the database.

import { createClient } from '@/lib/supabase/server'
import {
  addDays,
  currentStatus,
  dateKey,
  endOfDay,
  parseDateKey,
  rosterAlerts,
  startOfDay,
  summarizeDay,
} from '@/lib/shop/timeclock'
import type { RosterEntry, StatusResponse } from '@/lib/shop/timeclock'
import type { ShopJob, ShopTech, ShopTimeclock } from '@/lib/types'

export type ServerClient = Awaited<ReturnType<typeof createClient>>

/** How far back an unbounded punch query looks, and how many rows it returns. */
const DEFAULT_RANGE_DAYS = 14
const MAX_PUNCH_ROWS = 2000

export interface DateRange {
  /** Local midnight at the start of the first day. */
  from: Date
  /** Local end-of-day on the last day. */
  to: Date
  fromKey: string
  toKey: string
}

/**
 * Reads `from` / `to` (`YYYY-MM-DD`) off a query string. Bad or missing values
 * fall back to a sane window rather than erroring — the UI must still render.
 * A reversed range is swapped instead of returning nothing.
 */
export function parseRange(params: URLSearchParams, now: Date): DateRange {
  const rawFrom = parseDateKey(params.get('from') ?? '')
  const rawTo = parseDateKey(params.get('to') ?? '')

  let from = rawFrom ?? startOfDay(addDays(rawTo ?? now, -DEFAULT_RANGE_DAYS))
  let to = rawTo ?? now

  if (from.getTime() > to.getTime()) {
    const swap = from
    from = to
    to = swap
  }

  return {
    from: startOfDay(from),
    to: endOfDay(to),
    fromKey: dateKey(from),
    toKey: dateKey(to),
  }
}

/** Active techs in a shop, ordered for a stable roster. */
export async function fetchTechs(
  supabase: ServerClient,
  shopId: string,
): Promise<ShopTech[]> {
  const { data, error } = await supabase
    .from('shop_techs')
    .select('*')
    .eq('shop_id', shopId)
    .eq('active', true)
    .order('first_name', { ascending: true })
    .returns<ShopTech[]>()

  if (error) return []
  return data ?? []
}

export interface PunchQuery {
  shopId: string
  /** Omit for every tech in the shop; the callers always narrow this by role. */
  techId?: string
  from?: Date
  to?: Date
  /** Also pull still-open punches that started before `from`. */
  includeOpen?: boolean
}

/**
 * Punches for a shop, newest first. Every query is pinned to `shop_id`, and
 * the caller decides the tech scope. A query error degrades to an empty list.
 */
export async function fetchPunches(
  supabase: ServerClient,
  query: PunchQuery,
): Promise<ShopTimeclock[]> {
  let builder = supabase
    .from('shop_timeclock')
    .select('*')
    .eq('shop_id', query.shopId)

  if (query.techId) builder = builder.eq('tech_id', query.techId)

  if (query.from && query.includeOpen) {
    // Anything that started in the window, plus anything still running from
    // before it (an overnight punch still belongs on today's board).
    builder = builder.or(`punch_in.gte.${query.from.toISOString()},punch_out.is.null`)
  } else if (query.from) {
    builder = builder.gte('punch_in', query.from.toISOString())
  }

  if (query.to) builder = builder.lte('punch_in', query.to.toISOString())

  const { data, error } = await builder
    .order('punch_in', { ascending: false })
    .limit(MAX_PUNCH_ROWS)
    .returns<ShopTimeclock[]>()

  if (error) return []
  return data ?? []
}

/** Looks up the jobs referenced by a set of punches, for display labels. */
export async function fetchJobsByIds(
  supabase: ServerClient,
  shopId: string,
  jobIds: string[],
): Promise<ShopJob[]> {
  const unique = [...new Set(jobIds)]
  if (unique.length === 0) return []

  const { data, error } = await supabase
    .from('shop_jobs')
    .select('*')
    .eq('shop_id', shopId)
    .in('id', unique)
    .returns<ShopJob[]>()

  if (error) return []
  return data ?? []
}

/** Open (not completed/invoiced/voided) jobs a tech may punch into. */
export async function fetchPunchableJobs(
  supabase: ServerClient,
  shopId: string,
  techId: string,
  allJobs: boolean,
): Promise<ShopJob[]> {
  let builder = supabase
    .from('shop_jobs')
    .select('*')
    .eq('shop_id', shopId)
    .eq('voided', false)
    .in('status', ['estimate', 'approved', 'in_progress'])

  if (!allJobs) builder = builder.eq('assigned_tech_id', techId)

  const { data, error } = await builder
    .order('job_number', { ascending: false })
    .limit(100)
    .returns<ShopJob[]>()

  if (error) return []
  return data ?? []
}

/**
 * Builds the live roster for today. `selfOnly` is the privacy boundary: when
 * true the query, the tech list and the result all carry exactly one tech, so
 * a tech-role caller can never see another person's name, state or hours.
 */
export async function buildStatus(
  supabase: ServerClient,
  options: { shopId: string; selfTech: ShopTech; selfOnly: boolean; now: Date },
): Promise<StatusResponse> {
  const { shopId, selfTech, selfOnly, now } = options

  const techs: ShopTech[] = selfOnly ? [selfTech] : await fetchTechs(supabase, shopId)

  const punches = await fetchPunches(supabase, {
    shopId,
    techId: selfOnly ? selfTech.id : undefined,
    from: startOfDay(now),
    includeOpen: true,
  })

  const byTech = new Map<string, ShopTimeclock[]>()
  for (const punch of punches) {
    const list = byTech.get(punch.tech_id)
    if (list) list.push(punch)
    else byTech.set(punch.tech_id, [punch])
  }

  const jobs = await fetchJobsByIds(
    supabase,
    shopId,
    punches.map((p) => p.job_id).filter((id): id is string => id !== null),
  )
  const jobNumbers = new Map(jobs.map((job) => [job.id, job.job_number]))

  const roster: RosterEntry[] = techs.map((tech) => {
    const own = byTech.get(tech.id) ?? []
    const status = currentStatus(own, now)
    const summary = summarizeDay(own, now)
    const openPunch = status.openJob ?? status.openShop

    return {
      techId: tech.id,
      name: `${tech.first_name} ${tech.last_name}`.trim(),
      role: tech.role,
      state: status.state,
      jobId: status.openJob?.job_id ?? null,
      jobNumber: status.openJob?.job_id
        ? jobNumbers.get(status.openJob.job_id) ?? null
        : null,
      since: openPunch?.punch_in ?? null,
      sinceMinutes: status.openJob ? status.jobSinceMinutes : status.shopSinceMinutes,
      shopMinutes: summary.shopMinutes,
      jobMinutes: summary.jobMinutes,
      idleMinutes: summary.idleMinutes,
      byJob: summary.byJob.map((entry) => ({
        jobId: entry.jobId,
        jobNumber: jobNumbers.get(entry.jobId) ?? null,
        minutes: entry.minutes,
      })),
      alerts: rosterAlerts(own, now),
    }
  })

  // On the shop board, trouble floats to the top.
  if (!selfOnly) {
    roster.sort((a, b) => {
      if (a.alerts.length !== b.alerts.length) return b.alerts.length - a.alerts.length
      return a.name.localeCompare(b.name)
    })
  }

  return {
    now: now.toISOString(),
    scope: selfOnly ? 'self' : 'shop',
    roster,
  }
}

/**
 * Techs by id, active or not. Payroll needs this: someone who left mid-period
 * still worked the hours and still has to be paid for them.
 */
export async function fetchTechsByIds(
  supabase: ServerClient,
  shopId: string,
  ids: string[],
): Promise<ShopTech[]> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return []

  const { data, error } = await supabase
    .from('shop_techs')
    .select('*')
    .eq('shop_id', shopId)
    .in('id', unique)
    .returns<ShopTech[]>()

  if (error) return []
  return data ?? []
}

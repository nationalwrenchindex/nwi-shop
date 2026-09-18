// Shop efficiency: how much of the time the shop paid for actually made it onto
// an invoice. `hours billed / hours worked`, for one work week.
//
// The two halves come from two different places and neither one is a subset of
// the other:
//   * Worked  -> shop_timeclock. Wall-clock time a tech was on the shop floor.
//   * Billed  -> the `quantity` on `labor` line items of jobs that actually got
//                invoiced. A job sitting at `completed` has produced revenue on
//                paper but none in the bank, so it does not count yet.
// A score under 100% is normal (shop meetings, parts runs, warranty rework);
// the number is a trend line, not a grade.
//
// Every week/duration calculation is delegated to `@/lib/shop/timeclock`, which
// is the single source of truth for what a work week is and what one punch is
// worth. Nothing in this file re-derives either.
//
// NOTHING HERE THROWS. The shop_* migrations are applied by hand and may not all
// exist in a given environment; `fetchShopEfficiency` degrades a failed query to
// zero hours, which the card renders as "No hours yet" rather than a crash.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { LineItemType, ShopTimeclock } from '@/lib/types'
import {
  DEFAULT_WEEK_STARTS_ON,
  addDays,
  dateKey,
  startOfWeek,
  toHours,
  weekBuckets,
} from '@/lib/shop/timeclock'

// ---------------------------------------------------------------------------
// Score thresholds
// ---------------------------------------------------------------------------

/** At or above this the shop is billing well. */
export const EFFICIENCY_GOOD_PCT = 85

/** At or above this it is acceptable; below it, something is wrong. */
export const EFFICIENCY_WARN_PCT = 70

export type EfficiencyTone = 'good' | 'warn' | 'bad'

/** Which band a score falls in. `null` (no hours worked) has no band. */
export function efficiencyTone(pct: number | null): EfficiencyTone | null {
  if (pct === null) return null
  if (pct >= EFFICIENCY_GOOD_PCT) return 'good'
  if (pct >= EFFICIENCY_WARN_PCT) return 'warn'
  return 'bad'
}

// ---------------------------------------------------------------------------
// Pure math
// ---------------------------------------------------------------------------

/**
 * `billed / worked * 100`, rounded to one decimal.
 *
 * Returns **null**, never NaN or Infinity, when no hours were worked. A shop
 * that has not clocked in yet has no efficiency — it does not have an efficiency
 * of zero, and it certainly does not have an infinite one because someone
 * invoiced labor against a punch that was never made. Callers render null as a
 * dash. Every consumer of a score in this module goes through this function.
 */
export function efficiencyPct(hoursWorked: number, hoursBilled: number): number | null {
  if (!Number.isFinite(hoursWorked) || hoursWorked <= 0) return null
  const billed = Number.isFinite(hoursBilled) ? Math.max(0, hoursBilled) : 0
  return Math.round((billed / hoursWorked) * 1000) / 10
}

// ---------------------------------------------------------------------------
// Wire shape
// ---------------------------------------------------------------------------

export interface EfficiencyWeek {
  /** Local `YYYY-MM-DD` of the first day of the week. */
  weekStart:   string
  hoursWorked: number
  hoursBilled: number
  /** null when no hours were worked — see `efficiencyPct`. */
  pct:         number | null
}

export interface ShopEfficiency {
  current: EfficiencyWeek
  prior:   EfficiencyWeek
  /**
   * Week-over-week change in PERCENTAGE POINTS (not a percent of a percent),
   * or null when there is nothing honest to compare against: the prior week
   * must have real hours worked, and this week must too. A shop that was closed
   * last week gets no delta rather than a meaningless "+0".
   */
  deltaPoints: number | null
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/** The line-item columns the labor total actually reads. */
interface LaborLineRow {
  job_id:   string
  type:     LineItemType
  quantity: number | null
}

interface InvoicedJobRow {
  id:          string
  invoiced_at: string | null
}

/**
 * Pulls this week and last week for one shop and scores both.
 *
 * Two queries feed the billed side and they are deliberately **separate plain
 * selects stitched in JS**, not a PostgREST embedded resource: an embed depends
 * on the foreign-key name the migration happened to use, and a missing
 * relationship fails the WHOLE query rather than just the join. The same
 * reasoning is spelled out at length in app/shop/(app)/financials/_data.ts.
 *
 * `now` is explicit so the caller controls the clock and this stays testable.
 * This function never throws; a failed query yields zero hours on that side.
 */
export async function fetchShopEfficiency(
  supabase: SupabaseClient,
  shopId: string,
  now: Date,
): Promise<ShopEfficiency> {
  const currentStart = startOfWeek(now, DEFAULT_WEEK_STARTS_ON)
  const priorStart   = addDays(currentStart, -7)
  const currentEnd   = addDays(currentStart, 7)

  const currentKey = dateKey(currentStart)
  const priorKey   = dateKey(priorStart)

  const [worked, billed] = await Promise.all([
    fetchHoursWorked(supabase, shopId, priorStart, currentEnd, now),
    fetchHoursBilled(supabase, shopId, priorStart, currentEnd),
  ])

  const current: EfficiencyWeek = {
    weekStart:   currentKey,
    hoursWorked: worked.get(currentKey) ?? 0,
    hoursBilled: billed.get(currentKey) ?? 0,
    pct:         null,
  }
  const prior: EfficiencyWeek = {
    weekStart:   priorKey,
    hoursWorked: worked.get(priorKey) ?? 0,
    hoursBilled: billed.get(priorKey) ?? 0,
    pct:         null,
  }

  current.pct = efficiencyPct(current.hoursWorked, current.hoursBilled)
  prior.pct   = efficiencyPct(prior.hoursWorked, prior.hoursBilled)

  // Both sides must be real numbers, which by construction means both weeks had
  // hours worked. Rounded to one decimal to match the scores it is derived from.
  const deltaPoints =
    current.pct === null || prior.pct === null
      ? null
      : Math.round((current.pct - prior.pct) * 10) / 10

  return { current, prior, deltaPoints }
}

/**
 * Hours on the clock per week start, for the whole shop.
 *
 * Only `shop` punches are counted, because `weekBuckets` is what does the
 * counting and it drops `job` punches on purpose: a job punch runs at the same
 * time as the shop punch that contains it, so adding both would bill the same
 * hour twice and halve the score.
 *
 * An OPEN punch (punch_out null, total_minutes null) is NOT skipped — it is
 * passed through `punchMinutes` inside `weekBuckets`, which counts it up to
 * `now`. That is the whole reason the raw `total_minutes` column is never read
 * here: mid-shift on a Wednesday, every tech on the floor has an open punch, and
 * ignoring them would show a shop that has worked almost no hours this week.
 *
 * The window is filtered on `punch_in` because that is also how `weekBuckets`
 * attributes a punch: in full, to the week it started in.
 */
async function fetchHoursWorked(
  supabase: SupabaseClient,
  shopId: string,
  from: Date,
  to: Date,
  now: Date,
): Promise<Map<string, number>> {
  const hours = new Map<string, number>()

  try {
    const { data, error } = await supabase
      .from('shop_timeclock')
      .select('id, shop_id, tech_id, job_id, type, punch_in, punch_out, total_minutes, notes, created_at')
      .eq('shop_id', shopId)
      .gte('punch_in', from.toISOString())
      .lt('punch_in', to.toISOString())
      .returns<ShopTimeclock[]>()

    if (error || !data) return hours

    for (const bucket of weekBuckets(data, DEFAULT_WEEK_STARTS_ON, now)) {
      hours.set(bucket.weekStart, toHours(bucket.minutes))
    }
  } catch {
    return hours
  }

  return hours
}

/**
 * Labor hours that actually went out the door, per week start.
 *
 * An invoice is a `shop_jobs` row at status `invoiced` with `voided = false`,
 * and both filters are applied IN THE QUERY so a voided job cannot inflate the
 * score by way of a rendering bug. The week a job lands in is the week of its
 * `invoiced_at`, not the week the work was done — this is the billing side of
 * the ratio, so it follows the billing date.
 */
async function fetchHoursBilled(
  supabase: SupabaseClient,
  shopId: string,
  from: Date,
  to: Date,
): Promise<Map<string, number>> {
  const hours = new Map<string, number>()

  try {
    const { data: jobData, error: jobError } = await supabase
      .from('shop_jobs')
      .select('id, invoiced_at')
      .eq('shop_id', shopId)
      .eq('status', 'invoiced')
      .eq('voided', false)
      .gte('invoiced_at', from.toISOString())
      .lt('invoiced_at', to.toISOString())
      .returns<InvoicedJobRow[]>()

    if (jobError || !jobData || jobData.length === 0) return hours

    // job id -> the week bucket that job's revenue belongs to.
    const weekByJob = new Map<string, string>()
    for (const job of jobData) {
      if (!job.invoiced_at) continue
      const invoicedAt = new Date(job.invoiced_at)
      if (!Number.isFinite(invoicedAt.getTime())) continue
      weekByJob.set(job.id, dateKey(startOfWeek(invoicedAt, DEFAULT_WEEK_STARTS_ON)))
    }

    const jobIds = [...weekByJob.keys()]
    if (jobIds.length === 0) return hours

    const { data: lineData, error: lineError } = await supabase
      .from('shop_job_line_items')
      .select('job_id, type, quantity')
      .eq('shop_id', shopId)
      .eq('type', 'labor')
      .in('job_id', jobIds)
      .returns<LaborLineRow[]>()

    if (lineError || !lineData) return hours

    for (const line of lineData) {
      // `type` is re-checked here rather than trusted from the filter: one bad
      // row typed as a part would otherwise add its quantity — a part COUNT —
      // straight into an hours total.
      if (line.type !== 'labor') continue
      const week = weekByJob.get(line.job_id)
      if (!week) continue
      const qty = Number(line.quantity ?? 0)
      if (!Number.isFinite(qty) || qty <= 0) continue
      hours.set(week, (hours.get(week) ?? 0) + qty)
    }

    // Round once at the end so a long invoice's worth of quarter-hour lines does
    // not accumulate float drift into the displayed number.
    for (const [week, total] of hours) {
      hours.set(week, Math.round(total * 100) / 100)
    }
  } catch {
    return hours
  }

  return hours
}

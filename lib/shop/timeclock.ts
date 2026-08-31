// Pure time math for the shop timeclock. No I/O, no framework, no `Date.now()` —
// every function that needs the current instant takes it as an explicit `now`
// parameter so the whole module stays deterministic and unit-testable.
//
// Domain rules encoded here:
//   * A `shop` punch (job_id null) is the work day.
//   * A `job` punch (job_id set) is time booked against one job.
//   * Both can be open at once — a tech is on the shop clock AND on a job.
//   * Idle time = shop minutes - job minutes over the same window.
//   * Overtime is hours beyond 40 in a single work week, never per day.

import type { ShopRole, ShopTech, ShopTimeclock } from '@/lib/types'

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------

/** Idle minutes in a single day past which a tech is flagged on the roster. */
export const IDLE_ALERT_MINUTES = 60

/** Minutes on the shop clock with no open job punch before a tech is flagged. */
export const NO_JOB_ALERT_MINUTES = 30

/** Overtime starts after this many minutes inside one work week (40h). */
export const WEEKLY_OVERTIME_THRESHOLD_MINUTES = 40 * 60

/** Overtime is paid at time-and-a-half. */
export const OVERTIME_MULTIPLIER = 1.5

/** 0 = Sunday ... 6 = Saturday, matching `Date.prototype.getDay()`. */
export type WeekStartDay = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Work weeks run Sunday -> Saturday unless a caller says otherwise. */
export const DEFAULT_WEEK_STARTS_ON: WeekStartDay = 0

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * Whole minutes between two instants, never negative. A malformed timestamp
 * yields 0 rather than NaN so a single bad row cannot poison a total.
 */
export function minutesBetween(start: string | Date, end: string | Date): number {
  const a = toDate(start).getTime()
  const b = toDate(end).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(0, Math.round((b - a) / 60_000))
}

/**
 * Minutes on one punch. A closed punch trusts its stored `total_minutes` when
 * present, otherwise recomputes; an open punch counts up to `now`.
 */
export function punchMinutes(punch: ShopTimeclock, now: Date): number {
  if (punch.punch_out) {
    if (typeof punch.total_minutes === 'number' && Number.isFinite(punch.total_minutes)) {
      return Math.max(0, Math.round(punch.total_minutes))
    }
    return minutesBetween(punch.punch_in, punch.punch_out)
  }
  return minutesBetween(punch.punch_in, now)
}

/** `142` -> `"2h 22m"`, `47` -> `"47m"`, `0` -> `"0m"`. */
export function formatHm(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0
  const h = Math.floor(safe / 60)
  const m = safe % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Minutes -> decimal hours rounded to 2 places, the unit payroll runs on. */
export function toHours(minutes: number): number {
  const safe = Number.isFinite(minutes) ? Math.max(0, minutes) : 0
  return Math.round((safe / 60) * 100) / 100
}

// ---------------------------------------------------------------------------
// Calendar helpers (local time — the shop's wall clock is the shop's day)
// ---------------------------------------------------------------------------

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

export function startOfWeek(date: Date, weekStartsOn: WeekStartDay): Date {
  const d = startOfDay(date)
  const back = (d.getDay() - weekStartsOn + 7) % 7
  d.setDate(d.getDate() - back)
  return d
}

/** Local `YYYY-MM-DD`. Never use `toISOString()` here — that shifts to UTC. */
export function dateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Parses a `YYYY-MM-DD` input value as local midnight, not UTC midnight. */
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isFinite(d.getTime()) ? d : null
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime())
  d.setDate(d.getDate() + days)
  return d
}

// ---------------------------------------------------------------------------
// Day summary
// ---------------------------------------------------------------------------

export interface DaySummary {
  shopMinutes: number
  jobMinutes: number
  /** Shop time not booked to any job. Floored at 0. */
  idleMinutes: number
  /** Minutes per job id, descending. */
  byJob: { jobId: string; minutes: number }[]
}

/**
 * Totals a set of punches that all belong to the same tech and window.
 * Open punches count up to `now`.
 */
export function summarizeDay(punches: ShopTimeclock[], now: Date): DaySummary {
  let shopMinutes = 0
  let jobMinutes = 0
  const perJob = new Map<string, number>()

  for (const punch of punches) {
    const minutes = punchMinutes(punch, now)
    if (punch.type === 'shop') {
      shopMinutes += minutes
      continue
    }
    jobMinutes += minutes
    if (punch.job_id) {
      perJob.set(punch.job_id, (perJob.get(punch.job_id) ?? 0) + minutes)
    }
  }

  const byJob = [...perJob.entries()]
    .map(([jobId, minutes]) => ({ jobId, minutes }))
    .sort((a, b) => b.minutes - a.minutes)

  return {
    shopMinutes,
    jobMinutes,
    idleMinutes: Math.max(0, shopMinutes - jobMinutes),
    byJob,
  }
}

// ---------------------------------------------------------------------------
// Current status
// ---------------------------------------------------------------------------

export type ClockState = 'out' | 'shop' | 'job'

export interface CurrentStatus {
  state: ClockState
  openShop: ShopTimeclock | null
  openJob: ShopTimeclock | null
  /** Minutes on the open shop punch, 0 when not on the shop clock. */
  shopSinceMinutes: number
  /** Minutes on the open job punch, 0 when not on a job. */
  jobSinceMinutes: number
}

/** Resolves one tech's live state. `job` wins over `shop` for display. */
export function currentStatus(punches: ShopTimeclock[], now: Date): CurrentStatus {
  const openShop = punches.find((p) => p.type === 'shop' && !p.punch_out) ?? null
  const openJob = punches.find((p) => p.type === 'job' && !p.punch_out) ?? null

  return {
    state: openJob ? 'job' : openShop ? 'shop' : 'out',
    openShop,
    openJob,
    shopSinceMinutes: openShop ? minutesBetween(openShop.punch_in, now) : 0,
    jobSinceMinutes: openJob ? minutesBetween(openJob.punch_in, now) : 0,
  }
}

/**
 * How long a tech has been on the shop clock with nothing booked to a job.
 * Measured from the later of the shop punch-in and the most recent job
 * punch-out. Returns 0 when off the shop clock or currently on a job.
 */
export function minutesWithoutJob(punches: ShopTimeclock[], now: Date): number {
  const status = currentStatus(punches, now)
  if (!status.openShop || status.openJob) return 0

  let since = toDate(status.openShop.punch_in).getTime()
  if (!Number.isFinite(since)) return 0

  for (const punch of punches) {
    if (punch.type !== 'job' || !punch.punch_out) continue
    const ended = toDate(punch.punch_out).getTime()
    if (Number.isFinite(ended) && ended > since) since = ended
  }
  return minutesBetween(new Date(since), now)
}

export type AlertKind = 'idle' | 'no_job'

export interface RosterAlert {
  kind: AlertKind
  message: string
}

/** Roster warnings for one tech's day. An empty array means all clear. */
export function rosterAlerts(
  punches: ShopTimeclock[],
  now: Date,
  idleThreshold = IDLE_ALERT_MINUTES,
  noJobThreshold = NO_JOB_ALERT_MINUTES,
): RosterAlert[] {
  const alerts: RosterAlert[] = []
  const summary = summarizeDay(punches, now)

  if (summary.idleMinutes > idleThreshold) {
    alerts.push({
      kind: 'idle',
      message: `${formatHm(summary.idleMinutes)} idle today (over ${formatHm(idleThreshold)})`,
    })
  }

  const unbooked = minutesWithoutJob(punches, now)
  if (unbooked > noJobThreshold) {
    alerts.push({
      kind: 'no_job',
      message: `On the shop clock ${formatHm(unbooked)} with no job punch`,
    })
  }

  return alerts
}

// ---------------------------------------------------------------------------
// Weekly buckets + overtime
// ---------------------------------------------------------------------------

export interface WeekBucket {
  /** Local `YYYY-MM-DD` of the first day of the work week. */
  weekStart: string
  minutes: number
}

/**
 * Buckets **shop** punches into work weeks. Job punches are ignored on purpose:
 * they overlap the shop clock, so counting both would pay a tech twice.
 * A punch is attributed in full to the week it started in.
 */
export function weekBuckets(
  punches: ShopTimeclock[],
  weekStartsOn: WeekStartDay,
  now: Date,
): WeekBucket[] {
  const buckets = new Map<string, number>()

  for (const punch of punches) {
    if (punch.type !== 'shop') continue
    const started = toDate(punch.punch_in)
    if (!Number.isFinite(started.getTime())) continue
    const key = dateKey(startOfWeek(started, weekStartsOn))
    buckets.set(key, (buckets.get(key) ?? 0) + punchMinutes(punch, now))
  }

  return [...buckets.entries()]
    .map(([weekStart, minutes]) => ({ weekStart, minutes }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0))
}

export interface RegularOvertime {
  regular: number
  overtime: number
}

/**
 * Splits weekly minute totals into regular and overtime. Overtime is every
 * minute beyond 40 hours **within a single work week** — a 12-hour Tuesday in
 * a 30-hour week is all regular time.
 */
export function splitRegularOvertime(
  minutesByWeek: number[],
  thresholdMinutes = WEEKLY_OVERTIME_THRESHOLD_MINUTES,
): RegularOvertime {
  let regular = 0
  let overtime = 0

  for (const raw of minutesByWeek) {
    const minutes = Number.isFinite(raw) ? Math.max(0, raw) : 0
    regular += Math.min(minutes, thresholdMinutes)
    overtime += Math.max(0, minutes - thresholdMinutes)
  }

  return { regular, overtime }
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

export interface PayrollWeekRow {
  techId: string
  techName: string
  weekStart: string
  regularMinutes: number
  overtimeMinutes: number
  totalMinutes: number
  hasOvertime: boolean
}

export interface PayrollTechRow {
  techId: string
  techName: string
  regularMinutes: number
  overtimeMinutes: number
  totalMinutes: number
  payRate: number | null
  regularPay: number | null
  overtimePay: number | null
  totalPay: number | null
  weeks: PayrollWeekRow[]
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Builds the payroll table for a date range. Pure: `punches` must already be
 * filtered to the range, and `now` closes any still-open punch.
 *
 * `includePay` is the pay-rate gate — when false every money column comes back
 * null, so a caller without `viewPayRates` cannot leak a rate even by mistake.
 */
export function buildPayroll(
  techs: ShopTech[],
  punches: ShopTimeclock[],
  options: {
    now: Date
    weekStartsOn?: WeekStartDay
    includePay?: boolean
    overtimeMultiplier?: number
  },
): PayrollTechRow[] {
  const weekStartsOn = options.weekStartsOn ?? DEFAULT_WEEK_STARTS_ON
  const includePay = options.includePay ?? false
  const multiplier = options.overtimeMultiplier ?? OVERTIME_MULTIPLIER

  const byTech = new Map<string, ShopTimeclock[]>()
  for (const punch of punches) {
    const list = byTech.get(punch.tech_id)
    if (list) list.push(punch)
    else byTech.set(punch.tech_id, [punch])
  }

  return techs.map((tech) => {
    const techName = `${tech.first_name} ${tech.last_name}`.trim()
    const buckets = weekBuckets(byTech.get(tech.id) ?? [], weekStartsOn, options.now)

    const weeks: PayrollWeekRow[] = buckets.map((bucket) => {
      const split = splitRegularOvertime([bucket.minutes])
      return {
        techId: tech.id,
        techName,
        weekStart: bucket.weekStart,
        regularMinutes: split.regular,
        overtimeMinutes: split.overtime,
        totalMinutes: bucket.minutes,
        hasOvertime: split.overtime > 0,
      }
    })

    const totals = splitRegularOvertime(buckets.map((b) => b.minutes))
    const totalMinutes = totals.regular + totals.overtime

    const payRate = includePay ? tech.pay_rate : null
    const regularPay = payRate === null ? null : round2(toHours(totals.regular) * payRate)
    const overtimePay =
      payRate === null ? null : round2(toHours(totals.overtime) * payRate * multiplier)

    return {
      techId: tech.id,
      techName,
      regularMinutes: totals.regular,
      overtimeMinutes: totals.overtime,
      totalMinutes,
      payRate,
      regularPay,
      overtimePay,
      totalPay:
        regularPay === null || overtimePay === null ? null : round2(regularPay + overtimePay),
      weeks,
    }
  })
}

// ---------------------------------------------------------------------------
// Wire shapes shared by the API routes and the client components
// ---------------------------------------------------------------------------

export interface JobRef {
  id: string
  job_number: number
  description: string | null
}

export interface JobMinutes {
  jobId: string
  jobNumber: number | null
  minutes: number
}

export interface RosterEntry {
  techId: string
  name: string
  role: ShopRole
  state: ClockState
  /** The open job punch, when there is one. */
  jobId: string | null
  jobNumber: number | null
  /** ISO start of the punch that defines the current state. */
  since: string | null
  sinceMinutes: number
  shopMinutes: number
  jobMinutes: number
  idleMinutes: number
  byJob: JobMinutes[]
  alerts: RosterAlert[]
}

export interface StatusResponse {
  now: string
  scope: 'self' | 'shop'
  roster: RosterEntry[]
}

export interface PunchesResponse {
  now: string
  from: string
  to: string
  punches: ShopTimeclock[]
  jobs: JobRef[]
}

export interface PunchResult {
  ok: true
  punch: ShopTimeclock | null
  /** Punches this action closed as a side effect (job swap, shop punch-out). */
  closed: ShopTimeclock[]
  message: string
}

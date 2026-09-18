// Profit & loss for /shop/financials: the COST side of the period, plus the pure
// math that turns it and the already-computed revenue into gross profit.
//
// Revenue is deliberately NOT queried here. The page already has it from
// `summarize(fetchInvoices(...))`, and that figure means INVOICED revenue
// (shop_jobs at status 'invoiced', voided = false, dated by invoiced_at). It is the
// same number the QuickBooks export ships, so re-deriving it - or switching it to a
// cash/paid basis - would make two screens disagree about the same period. The P&L
// therefore runs on an ACCRUAL basis and the UI labels it as such.
//
// Two halves, deliberately separated:
//   * `fetch*` do I/O and never throw. They return `{ value, error }` exactly like
//     `fetchInvoices`, because the shop_* migrations are applied BY HAND and a
//     missing table must render an amber banner, not a 500.
//   * `compute*` are pure. No Supabase, no Next, no `Date.now()` - every function
//     that needs the current instant takes it as an explicit `now`, so the money
//     math is unit-testable the same way `lib/shop/quickbooks.ts` is.

import { createClient } from '@/lib/supabase/server'
import { nextDay } from '@/lib/shop/quickbooks'
import {
  buildPayroll,
  toHours,
  DEFAULT_WEEK_STARTS_ON,
  OVERTIME_MULTIPLIER,
  WEEKLY_OVERTIME_THRESHOLD_MINUTES,
} from '@/lib/shop/timeclock'
import type { ShopTech, ShopTimeclock } from '@/lib/types'

// --- Result contract --------------------------------------------------------

/**
 * Mirrors the `{ invoices, error }` shape of `fetchInvoices`: a non-null `error`
 * means the number in `value` is a safe zero, not a real zero. Callers surface the
 * message and keep rendering.
 */
export interface CostFetch<T> {
  value:  T
  error:  string | null
}

/** Ceiling on rows pulled per cost query. Paired with an exact count so a period
 *  that exceeds it reports an error instead of silently understating cost. */
const MAX_COST_ROWS = 20_000

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * The exclusive upper bound of an inclusive `YYYY-MM-DD` range, as an instant.
 * Same `< nextDay(to) 00:00Z` convention `fetchInvoices` uses, so a punch or a
 * parts issue stamped at 4pm on the last day of the range is not dropped.
 */
function rangeEndInstant(to: string): Date {
  return new Date(`${nextDay(to)}T00:00:00.000Z`)
}

// --- Parts cost -------------------------------------------------------------

export interface PartsCost {
  /** Dollars of inventory consumed in the period. Always >= 0. */
  cost:     number
  /** How many `used` ledger rows fed the figure - shown as a provenance hint. */
  txCount:  number
}

export const EMPTY_PARTS_COST: PartsCost = { cost: 0, txCount: 0 }

/**
 * Sums the parts-cost side of the inventory ledger.
 *
 * TWO THINGS ABOUT `shop_inventory_transactions.cost` THAT ARE EASY TO GET WRONG:
 *
 *  1. It is ALREADY EXTENDED. The write paths store `quantity * unit_cost`
 *     (`app/api/shop/inventory/use/route.ts`, `.../[id]/receive/route.ts`), not a
 *     per-unit price. There is no `cost_price` column. Multiplying `cost` by
 *     `quantity` again would square the quantity and inflate the P&L wildly.
 *
 *  2. It is SIGNED, following `quantity`. Stock leaving the shelf is written
 *     negative (`cost: -roundCents(quantity * part.unit_cost)` on type 'used');
 *     a receipt is written positive. So consumed cost is `abs(sum)`.
 *
 * Only `type = 'used'` is counted:
 *   * `received` is a purchase INTO inventory - an asset swap, not an expense of
 *     the period. It becomes cost when it is used.
 *   * `adjusted` is a cycle-count/shrink correction, not a job cost.
 *   * `returned` is NOT netted against the total. Nothing in the codebase writes a
 *     'returned' row today (the value exists only in the InventoryTxType union and
 *     in INVENTORY_TX_TYPES), so its sign convention is unverified. Netting a row
 *     whose sign is a guess could just as easily double the cost as reduce it, and
 *     the sum is zero either way until a write path exists. When one is added,
 *     revisit this with its sign in hand.
 */
export async function fetchPartsCost(
  shopId: string,
  from: string,
  to: string,
): Promise<CostFetch<PartsCost>> {
  const supabase = await createClient()

  const { data, error, count } = await supabase
    .from('shop_inventory_transactions')
    .select('cost', { count: 'exact' })
    .eq('shop_id', shopId)
    .eq('type', 'used')
    .gte('created_at', `${from}T00:00:00.000Z`)
    .lt('created_at', rangeEndInstant(to).toISOString())
    .limit(MAX_COST_ROWS)

  if (error) return { value: EMPTY_PARTS_COST, error: error.message }

  const rows = (data ?? []) as { cost: number | null }[]

  // A silently truncated page would understate cost, which is the one failure mode
  // a P&L must never have quietly. Report it instead of returning a short total.
  if (typeof count === 'number' && count > rows.length) {
    return {
      value: EMPTY_PARTS_COST,
      error: `${count.toLocaleString()} parts transactions in this period exceed the ${MAX_COST_ROWS.toLocaleString()}-row query limit. Narrow the range.`,
    }
  }

  return { value: computePartsCost(rows), error: null }
}

/** Pure half of `fetchPartsCost`: `abs(sum(cost))` over already-filtered rows. */
export function computePartsCost(rows: { cost: number | null }[]): PartsCost {
  let signed = 0
  for (const row of rows) signed += num(row.cost)

  return {
    cost:    round2(Math.abs(signed)),
    txCount: rows.length,
  }
}

// --- Labor cost -------------------------------------------------------------

export interface LaborCost {
  /** Dollars owed for the period - ONLY for techs that have a pay_rate. */
  cost:              number
  /** Every hour on the shop clock in the period, priced or not. */
  hours:             number
  /** Hours worked by techs with a null pay_rate. These are NOT in `cost`. */
  unpricedHours:     number
  /** How many techs worked in the period with no pay_rate on file. */
  techsWithoutRate:  number
  /** Hours past 40/week, already billed into `cost` at OVERTIME_MULTIPLIER. */
  overtimeHours:     number
}

export const EMPTY_LABOR_COST: LaborCost = {
  cost:             0,
  hours:            0,
  unpricedHours:    0,
  techsWithoutRate: 0,
  overtimeHours:    0,
}

/** Re-exported so a card hint can state the rule instead of hard-coding "40h". */
export const OVERTIME_THRESHOLD_HOURS = WEEKLY_OVERTIME_THRESHOLD_MINUTES / 60
export { OVERTIME_MULTIPLIER }

/**
 * Punches in the period plus the techs that made them.
 *
 * Two separate selects stitched in JS, never a PostgREST embedded resource: an
 * embed resolves through a foreign-key NAME that varies with how the migration was
 * written, and a missing relationship fails the WHOLE query - which here would zero
 * out labor cost. Two plain selects always work.
 *
 * A punch is attributed to the period by `punch_in`, matching how `weekBuckets`
 * attributes one to a week.
 */
export async function fetchLaborCost(
  shopId: string,
  from: string,
  to: string,
  nowInput: Date = new Date(),
): Promise<CostFetch<LaborCost>> {
  const supabase = await createClient()
  const rangeEnd = rangeEndInstant(to)

  // An open punch accrues up to `now`. For a CLOSED historical period that would
  // charge today's minutes to last quarter, so `now` is clamped to the end of the
  // range: a punch left open in March stops accruing on March 31.
  const now = new Date(Math.min(nowInput.getTime(), rangeEnd.getTime()))

  const { data: punchData, error: punchError, count } = await supabase
    .from('shop_timeclock')
    .select('*', { count: 'exact' })
    .eq('shop_id', shopId)
    .eq('type', 'shop')
    .gte('punch_in', `${from}T00:00:00.000Z`)
    .lt('punch_in', rangeEnd.toISOString())
    .order('punch_in', { ascending: true })
    .limit(MAX_COST_ROWS)
    .returns<ShopTimeclock[]>()

  if (punchError) return { value: EMPTY_LABOR_COST, error: punchError.message }

  const punches = punchData ?? []

  if (typeof count === 'number' && count > punches.length) {
    return {
      value: EMPTY_LABOR_COST,
      error: `${count.toLocaleString()} punches in this period exceed the ${MAX_COST_ROWS.toLocaleString()}-row query limit. Narrow the range.`,
    }
  }

  if (punches.length === 0) return { value: EMPTY_LABOR_COST, error: null }

  const techIds = [...new Set(punches.map(p => p.tech_id).filter((v): v is string => !!v))]

  const { data: techData, error: techError } = await supabase
    .from('shop_techs')
    .select('*')
    .eq('shop_id', shopId)
    .in('id', techIds)
    .returns<ShopTech[]>()

  // Without the techs there are no pay rates, so labor cost would come back $0 with
  // nothing to distinguish it from "nobody worked". That silent understatement is
  // the exact failure this module refuses to produce, so it is reported.
  if (techError) return { value: EMPTY_LABOR_COST, error: techError.message }

  return { value: computeLaborCost(techData ?? [], punches, now), error: null }
}

/**
 * Pure half of `fetchLaborCost`. Built on `buildPayroll` rather than a second
 * implementation of hours * rate, so the P&L and the payroll screen can never
 * disagree about what a week of work costs.
 *
 * OVERTIME IS APPLIED: minutes past 40 in a work week are paid at 1.5x, the same
 * rule payroll runs, so this is not a straight-time approximation. One caveat worth
 * knowing - `buildPayroll` buckets a punch into the week it STARTED in, and the
 * punches handed to it are already clipped to the selected period, so a range that
 * begins or ends mid-week sees only part of that week and can under-detect overtime
 * at the two boundaries. It errs low, never high.
 *
 * ONLY `type = 'shop'` PUNCHES ARE PAID. Job punches overlap the shop clock by
 * design (a tech is on the shop clock AND on a job), so counting both would pay
 * every tech twice. `weekBuckets` encodes the same rule.
 *
 * NULL pay_rate is NOT treated as $0. `shop_techs.pay_rate` is genuinely nullable,
 * and folding an unrated tech in at zero would present a short labor cost as a
 * complete one. Those hours are quarantined into `unpricedHours` /
 * `techsWithoutRate` so the card can say the number is incomplete and by how much.
 */
export function computeLaborCost(
  techs: ShopTech[],
  punches: ShopTimeclock[],
  now: Date,
): LaborCost {
  const rows = buildPayroll(techs, punches, {
    now,
    weekStartsOn:       DEFAULT_WEEK_STARTS_ON,
    includePay:         true,
    overtimeMultiplier: OVERTIME_MULTIPLIER,
  })

  let cost             = 0
  let minutes          = 0
  let unpricedMinutes  = 0
  let overtimeMinutes  = 0
  let techsWithoutRate = 0

  for (const row of rows) {
    if (row.totalMinutes <= 0) continue // a tech who did not work is not a gap

    minutes         += row.totalMinutes
    overtimeMinutes += row.overtimeMinutes

    // `payRate === null` means "no rate on file", NOT "free". A stored 0 is a real
    // rate a manager typed and is priced as written.
    if (row.payRate === null) {
      unpricedMinutes  += row.totalMinutes
      techsWithoutRate += 1
      continue
    }

    cost += row.totalPay ?? 0
  }

  return {
    cost:          round2(cost),
    hours:         toHours(minutes),
    unpricedHours: toHours(unpricedMinutes),
    techsWithoutRate,
    overtimeHours: toHours(overtimeMinutes),
  }
}

// --- P&L math ---------------------------------------------------------------

export interface Pnl {
  /** Pre-tax INVOICED revenue, passed in from `summarize()`. Accrual, not cash. */
  revenue:      number
  partsCost:    number
  laborCost:    number
  /** revenue - partsCost - laborCost. Legitimately negative in a bad period. */
  grossProfit:  number
  /** grossProfit / revenue * 100. 0 when there is no revenue to divide by. */
  marginPct:    number
}

/**
 * The whole P&L in one pure expression. Every input is coerced through `num()`
 * first, so a malformed row upstream yields a wrong-but-finite number rather than
 * NaN spreading across four cards.
 *
 * Gross profit is NOT clamped at 0. A period that invoiced less than it spent is a
 * real outcome and the manager needs to see the negative number.
 */
export function computePnl(input: {
  revenue:   number
  partsCost: number
  laborCost: number
}): Pnl {
  const revenue     = round2(num(input.revenue))
  const partsCost   = round2(num(input.partsCost))
  const laborCost   = round2(num(input.laborCost))
  const grossProfit = round2(revenue - partsCost - laborCost)

  return {
    revenue,
    partsCost,
    laborCost,
    grossProfit,
    // Guarded rather than clamped: with no revenue the ratio is undefined, and 0%
    // is the only honest thing to print. The dollar figure still shows the loss.
    marginPct: revenue > 0 ? round2((grossProfit / revenue) * 100) : 0,
  }
}

/**
 * Bar width for a margin percentage, clamped to [0, 100].
 *
 * Presentation only - the TRUE percentage, negative sign and all, is always
 * rendered as text beside the bar. A negative CSS width is a rendering bug, and a
 * gross margin above 100% is impossible, so both ends are pinned.
 */
export function marginBarWidth(marginPct: number): number {
  if (!Number.isFinite(marginPct)) return 0
  return Math.min(100, Math.max(0, marginPct))
}

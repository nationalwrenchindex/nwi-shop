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
// Parts cost is not queried here either - see `partsCostFrom`. It comes off the
// same `FinancialSummary` the cards above it use, because deriving it separately
// is exactly the bug that put two different parts costs on one screen.
//
// That leaves LABOR as the only thing this file actually fetches.
//
// Two halves, deliberately separated:
//   * `fetch*` do I/O and never throw. They return `{ value, error }` exactly like
//     `fetchInvoices`, because the shop_* migrations are applied BY HAND and a
//     missing table must render an amber banner, not a 500.
//   * `compute*` are pure. No Supabase, no Next, no `Date.now()` - every function
//     that needs the current instant takes it as an explicit `now`, so the money
//     math is unit-testable the same way `lib/shop/quickbooks.ts` is.

import { createClient } from '@/lib/supabase/server'
import {
  nextDay,
  type ExportInvoice,
  type FinancialSummary,
} from '@/lib/shop/quickbooks'
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
  /** Cost of the parts billed on this period's invoices. Always >= 0. */
  cost:       number
  /** How many part lines fed the figure - shown as a provenance hint. */
  lineCount:  number
}

export const EMPTY_PARTS_COST: PartsCost = { cost: 0, lineCount: 0 }

/**
 * Parts cost for the period, taken from THE INVOICES THEMSELVES.
 *
 * WHY NOT THE INVENTORY LEDGER — this was the original implementation and it was
 * wrong. `shop_inventory_transactions` measures STOCK MOVEMENT, not the cost of
 * what was billed, and the two diverge in normal use:
 *
 *   * Adding a part to a job through `POST /api/shop/jobs/[id]/line-items` bills
 *     the customer and stamps `unit_cost` on the line, but writes NO ledger row
 *     and does not decrement the shelf - only `/api/shop/inventory/use` does. So
 *     a part sold the ordinary way was invisible to a ledger-based parts cost,
 *     and gross profit came out overstated by exactly its cost.
 *   * A part issued in one period and invoiced in the next lands in the wrong
 *     period entirely, because the ledger is dated by issue and revenue by
 *     `invoiced_at`.
 *
 * Worse, the figure contradicted the one on screen directly above it:
 * `SummaryCards` has always derived parts cost from the line items via
 * `summarize()`, so the same page showed two different parts costs. Observed on
 * live data at a $379.00 gap from a single job.
 *
 * So the number is no longer derived independently AT ALL. It is taken from the
 * `FinancialSummary` the page already computed, which makes a disagreement
 * between the two blocks structurally impossible rather than merely unlikely, and
 * costs no extra query. `summarize()` is the single source of truth for what a
 * period's parts cost is; this function only attaches the provenance count.
 */
export function partsCostFrom(
  summary: Pick<FinancialSummary, 'partsCost'>,
  invoices: ExportInvoice[],
): PartsCost {
  let lineCount = 0
  for (const inv of invoices) {
    for (const li of inv.line_items ?? []) {
      if (li.type === 'part') lineCount += 1
    }
  }

  return {
    cost:      round2(num(summary.partsCost)),
    lineCount,
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

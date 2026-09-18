// Profit & loss block for the selected period. Presentational only - every figure
// is computed in `@/lib/shop/pnl`, so this file and any future export of the same
// numbers cannot drift apart.
//
// Costs are shown in full: /shop/financials is manager-only (viewFinancials is
// false for foreman and tech), so there is nothing to redact.
//
// The honesty rules this block exists to enforce:
//   * Revenue is labelled "invoiced", because that is what it is. It is the same
//     accrual figure the QuickBooks export ships, NOT cash received.
//   * Labor cost is short whenever a tech has no pay_rate, and it says so out loud
//     rather than quietly presenting a null rate as $0.
//   * A negative gross profit renders in rose with its real sign. Only the WIDTH of
//     the margin bar is clamped; the percentage text is never clamped.

import {
  marginBarWidth,
  OVERTIME_MULTIPLIER,
  OVERTIME_THRESHOLD_HOURS,
  type LaborCost,
  type PartsCost,
  type Pnl,
} from '@/lib/shop/pnl'
import { formatMoney, formatPercent } from './format'

const HOURS = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

function formatHours(value: number): string {
  return `${HOURS.format(Number.isFinite(value) ? value : 0)} h`
}

function Stat({
  label, value, hint, tone = 'neutral',
}: {
  label:  string
  value:  string
  hint?:  string
  tone?:  'neutral' | 'cost' | 'good' | 'bad'
}) {
  const valueTone =
    tone === 'cost' ? 'text-rose-700'
    : tone === 'bad' ? 'text-rose-700'
    : tone === 'good' ? 'text-emerald-700'
    : 'text-slate-900'

  return (
    <div className="nwi-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${valueTone}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export default function PnlCards({
  pnl, parts, labor, partsError, laborError,
}: {
  pnl:         Pnl
  parts:       PartsCost
  labor:       LaborCost
  /** Non-null when the parts query failed - its cost is a placeholder zero. */
  partsError:  string | null
  /** Non-null when the timeclock or tech query failed - labor is a placeholder. */
  laborError:  string | null
}) {
  const profitable = pnl.grossProfit >= 0
  // Width only. `pnl.marginPct` keeps its true sign for the text beside the bar,
  // because a -12% margin is information, not a rendering error.
  const barWidth = marginBarWidth(pnl.marginPct)

  const laborHint = laborError
    ? 'Unavailable for this period'
    : labor.overtimeHours > 0
      ? `${formatHours(labor.hours)} on the clock · ${formatHours(labor.overtimeHours)} at ${OVERTIME_MULTIPLIER}x`
      : `${formatHours(labor.hours)} on the clock · straight time`

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Profit &amp; loss</h2>
        <p className="text-xs text-slate-500">
          Accrual basis · revenue is what was invoiced in this period, not what was collected
        </p>
      </div>

      {/* One banner per failed cost query. Same amber treatment the invoice error
          uses: the shop_* migrations are applied by hand and a missing table must
          not take the page down - but a $0 cost that is really a failure has to be
          called out, or the margin below reads as good news. */}
      {partsError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Could not load parts cost for this period: {partsError} — parts cost is
          shown as $0.00 and gross profit is overstated.
        </div>
      )}
      {laborError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Could not load labor cost for this period: {laborError} — labor cost is
          shown as $0.00 and gross profit is overstated.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Revenue (invoiced)"
          value={formatMoney(pnl.revenue)}
          hint="Pre-tax, invoiced in this period — not payments received"
        />
        <Stat
          label="Parts cost"
          value={formatMoney(pnl.partsCost)}
          hint={
            partsError
              ? 'Unavailable for this period'
              : `Inventory consumed · ${parts.txCount.toLocaleString()} issue${parts.txCount === 1 ? '' : 's'}`
          }
          tone="cost"
        />
        <Stat
          label="Labor cost"
          value={formatMoney(pnl.laborCost)}
          hint={laborHint}
          tone="cost"
        />
        <Stat
          label="Gross profit"
          value={formatMoney(pnl.grossProfit)}
          hint={`${formatPercent(pnl.marginPct)} of revenue · revenue less parts and labor`}
          tone={profitable ? 'good' : 'bad'}
        />
      </div>

      {/* Techs with no pay_rate are the one way this P&L can be quietly wrong, so
          the gap is stated with the hours attached rather than folded in at $0. */}
      {!laborError && labor.techsWithoutRate > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {labor.techsWithoutRate} tech{labor.techsWithoutRate === 1 ? ' has' : 's have'} no pay
          rate set. {formatHours(labor.unpricedHours)} worked in this period {labor.techsWithoutRate === 1 ? 'is' : 'are'} not
          priced, so labor cost is understated and gross profit is overstated.
        </div>
      )}

      <div className="nwi-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gross margin</p>
          <p className={`font-mono text-lg font-semibold tabular-nums ${profitable ? 'text-emerald-700' : 'text-rose-700'}`}>
            {formatPercent(pnl.marginPct)}
          </p>
        </div>

        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
          {/* barWidth is clamped to [0,100]; a loss therefore renders as an empty
              track with the real negative percentage printed above it. */}
          <div
            className={profitable ? 'h-full bg-emerald-600' : 'h-full bg-rose-600'}
            style={{ width: `${barWidth}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
          <span className="font-mono tabular-nums">
            Revenue {formatMoney(pnl.revenue)}
          </span>
          <span className="font-mono tabular-nums">
            − Parts {formatMoney(pnl.partsCost)}
          </span>
          <span className="font-mono tabular-nums">
            − Labor {formatMoney(pnl.laborCost)}
          </span>
          <span className={`ml-auto font-mono font-semibold tabular-nums ${profitable ? 'text-emerald-700' : 'text-rose-700'}`}>
            = {formatMoney(pnl.grossProfit)}
          </span>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Labor is shop-clock hours × pay rate, with hours past {OVERTIME_THRESHOLD_HOURS} in a
          work week paid at {OVERTIME_MULTIPLIER}×. Job punches are excluded because they overlap
          the shop clock. Parts cost is inventory issued to jobs at unit cost, not the parts price
          billed to the customer.
        </p>
      </div>
    </section>
  )
}

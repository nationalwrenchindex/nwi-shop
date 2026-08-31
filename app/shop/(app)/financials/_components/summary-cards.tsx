// Financial summary for the selected range. Presentational only - every number is
// computed by `summarize()` so this file and the export cannot disagree.
//
// Cost and margin are shown in full: /shop/financials is manager-only
// (viewFinancials is false for foreman and tech), so there is nothing to redact.

import type { FinancialSummary } from '@/lib/shop/quickbooks'
import { formatMoney, formatPercent } from './format'

function Stat({
  label, value, hint, emphasis = false,
}: {
  label:     string
  value:     string
  hint?:     string
  emphasis?: boolean
}) {
  return (
    <div className={`nwi-card p-4 ${emphasis ? 'bg-slate-900 text-white' : ''}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${emphasis ? 'text-slate-300' : 'text-slate-500'}`}>
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value}</p>
      {hint && (
        <p className={`mt-1 text-xs ${emphasis ? 'text-slate-400' : 'text-slate-500'}`}>{hint}</p>
      )}
    </div>
  )
}

export default function SummaryCards({ summary }: { summary: FinancialSummary }) {
  const { revenue, laborRevenue, partsRevenue } = summary
  // Guarded so an empty range renders a flat bar instead of NaN widths.
  const laborPct = revenue > 0 ? (laborRevenue / revenue) * 100 : 0
  const partsPct = revenue > 0 ? (partsRevenue / revenue) * 100 : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Invoiced revenue"
          value={formatMoney(revenue)}
          hint="Pre-tax. Sales tax is shown separately."
          emphasis
        />
        <Stat
          label="Gross margin"
          value={formatMoney(summary.grossMargin)}
          hint={`${formatPercent(summary.marginPct)} of revenue · parts cost only`}
        />
        <Stat
          label="Invoices"
          value={String(summary.invoiceCount)}
          hint="Voided invoices excluded"
        />
        <Stat
          label="Average invoice"
          value={formatMoney(summary.avgInvoice)}
          hint="Including sales tax"
        />
      </div>

      <div className="nwi-card p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Labor revenue</p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{formatMoney(laborRevenue)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parts revenue</p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{formatMoney(partsRevenue)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parts cost</p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-rose-700">
              {formatMoney(summary.partsCost)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sales tax collected</p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{formatMoney(summary.taxCollected)}</p>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="bg-slate-900" style={{ width: `${laborPct}%` }} />
            <div className="bg-amber-500" style={{ width: `${partsPct}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-900" />
              Labor {formatPercent(laborPct)}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              Parts {formatPercent(partsPct)}
            </span>
            <span className="ml-auto font-mono tabular-nums">
              Total invoiced {formatMoney(summary.totalInvoiced)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

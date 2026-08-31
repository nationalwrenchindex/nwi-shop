// Invoice list for the selected range. One row per invoiced job, voided excluded
// by the query in _data.ts. Money columns are right-aligned monospaced numerals so
// the decimal points line up when a manager scans the column.

import Link from 'next/link'
import {
  invoiceTotals,
  type ExportInvoice,
  type ExportShop,
  type FinancialSummary,
} from '@/lib/shop/quickbooks'
import { formatDate, formatMoney } from './format'

interface Props {
  invoices: ExportInvoice[]
  shop:     ExportShop
  summary:  FinancialSummary
}

const MONEY_CELL = 'px-3 py-3 text-right font-mono text-sm tabular-nums whitespace-nowrap'
const MONEY_HEAD = 'px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500'
const TEXT_HEAD  = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500'

export default function InvoiceTable({ invoices, shop, summary }: Props) {
  if (invoices.length === 0) {
    return (
      <div className="nwi-card p-8 text-center">
        <p className="text-sm font-semibold text-slate-700">No invoices in this period</p>
        <p className="mt-1 text-sm text-slate-500">
          A job appears here once it is marked invoiced. Widen the period to see more.
        </p>
      </div>
    )
  }

  return (
    <div className="nwi-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-200">
              <th scope="col" className={TEXT_HEAD}>Job #</th>
              <th scope="col" className={TEXT_HEAD}>Invoiced</th>
              <th scope="col" className={TEXT_HEAD}>Customer</th>
              <th scope="col" className={TEXT_HEAD}>Vehicle</th>
              <th scope="col" className={MONEY_HEAD}>Labor</th>
              <th scope="col" className={MONEY_HEAD}>Parts</th>
              <th scope="col" className={MONEY_HEAD}>Tax</th>
              <th scope="col" className={MONEY_HEAD}>Total</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map(inv => {
              const totals = invoiceTotals(inv, shop)
              return (
                <tr key={inv.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-3 whitespace-nowrap">
                    <Link
                      href={`/shop/jobs/${inv.id}`}
                      className="font-mono text-sm font-semibold tabular-nums text-slate-900 underline underline-offset-2"
                    >
                      #{inv.job_number}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-sm whitespace-nowrap text-slate-600">
                    {formatDate(inv.invoiced_at ?? inv.created_at)}
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-900">
                    {inv.customer_name ?? <span className="text-slate-400">No customer</span>}
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-600">
                    {inv.vehicle_label ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className={`${MONEY_CELL} text-slate-600`}>{formatMoney(totals.labor)}</td>
                  <td className={`${MONEY_CELL} text-slate-600`}>{formatMoney(totals.parts)}</td>
                  <td className={`${MONEY_CELL} text-slate-500`}>{formatMoney(totals.tax)}</td>
                  <td className={`${MONEY_CELL} font-semibold text-slate-900`}>{formatMoney(totals.total)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50">
              <td className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500" colSpan={4}>
                {summary.invoiceCount} invoice{summary.invoiceCount === 1 ? '' : 's'}
              </td>
              <td className={`${MONEY_CELL} text-slate-700`}>{formatMoney(summary.laborRevenue)}</td>
              <td className={`${MONEY_CELL} text-slate-700`}>{formatMoney(summary.partsRevenue)}</td>
              <td className={`${MONEY_CELL} text-slate-700`}>{formatMoney(summary.taxCollected)}</td>
              <td className={`${MONEY_CELL} font-semibold text-slate-900`}>{formatMoney(summary.totalInvoiced)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

import Link from 'next/link'
import {
  TX_TYPE_BADGE,
  TX_TYPE_LABELS,
  formatMoney,
  type TransactionRow,
} from '@/lib/shop/inventory'

interface TransactionHistoryProps {
  rows:        TransactionRow[]
  /** Extended cost of each movement, for viewMargins callers only. */
  viewMargins: boolean
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', {
    month:  'short',
    day:    'numeric',
    year:   'numeric',
    hour:   'numeric',
    minute: '2-digit',
  })
}

export default function TransactionHistory({ rows, viewMargins }: TransactionHistoryProps) {
  return (
    <div className="nwi-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Part</th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Type</th>
              <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Qty</th>
              {viewMargins ? (
                <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Ext. cost</th>
              ) : null}
              <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Job</th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Tech</th>
              <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={viewMargins ? 8 : 7} className="px-3 py-10 text-center text-sm text-slate-500">
                  No movements match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {formatDate(row.created_at)}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono font-semibold text-slate-900">
                      {row.part_number ?? '—'}
                    </span>
                    {row.part_description ? (
                      <span className="ml-2 text-slate-600">{row.part_description}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TX_TYPE_BADGE[row.type]}`}
                    >
                      {TX_TYPE_LABELS[row.type]}
                    </span>
                  </td>
                  {/* The ledger's quantity carries its own sign — stock out is
                      already negative, so it is shown exactly as stored. */}
                  <td
                    className={`px-3 py-2 text-right font-semibold tabular-nums ${
                      row.quantity < 0 ? 'text-sky-700' : 'text-slate-900'
                    }`}
                  >
                    {row.quantity > 0 ? '+' : ''}
                    {row.quantity}
                  </td>
                  {viewMargins ? (
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {formatMoney(row.cost ?? 0)}
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    {row.job_id ? (
                      <Link
                        href={`/shop/jobs/${row.job_id}`}
                        className="font-semibold text-slate-900 underline underline-offset-2 hover:text-slate-600"
                      >
                        #{row.job_number ?? '—'}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{row.tech_name ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{row.notes ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

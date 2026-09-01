// Recent review requests. A plain server component — nothing here is
// interactive, so it ships no JavaScript.

import {
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_PILL,
  type ReviewRequestRow,
} from '@/lib/shop/torquewrench/types'

function when(value: string | null): string {
  if (!value) return '—'
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function RequestsTable({ rows }: { rows: ReviewRequestRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="nwi-card p-6 text-center">
        <p className="text-sm font-medium text-slate-700">No review requests yet</p>
        <p className="mt-1 text-sm text-slate-500">
          One is queued each time a job is marked complete, once review requests
          are switched on above.
        </p>
      </div>
    )
  }

  return (
    <div className="nwi-card overflow-x-auto">
      <table className="w-full min-w-[46rem] text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">Job</th>
            <th scope="col" className="px-4 py-3 font-semibold">Customer</th>
            <th scope="col" className="px-4 py-3 font-semibold">Status</th>
            <th scope="col" className="px-4 py-3 font-semibold">Sent</th>
            <th scope="col" className="px-4 py-3 font-semibold">Clicked</th>
            <th scope="col" className="px-4 py-3 font-semibold">Rating</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id} className="align-top">
              <td className="px-4 py-3 font-mono text-xs text-slate-600">
                {row.job_number != null ? `#${row.job_number}` : '—'}
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-slate-900">{row.customer_name}</div>
                {row.phone ? (
                  <div className="text-xs text-slate-500">{row.phone}</div>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                    REVIEW_STATUS_PILL[row.status]
                  }`}
                >
                  {REVIEW_STATUS_LABELS[row.status]}
                </span>
                {/* The reason a request was skipped or failed is the whole point
                    of showing this row at all — never hide it behind a tooltip. */}
                {row.error ? (
                  <div className="mt-1 max-w-56 text-xs text-slate-500">{row.error}</div>
                ) : null}
              </td>
              <td className="px-4 py-3 text-slate-600">{when(row.sent_at)}</td>
              <td className="px-4 py-3 text-slate-600">{when(row.clicked_at)}</td>
              <td className="px-4 py-3 text-slate-600">
                {row.rating != null ? `${row.rating} / 5` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

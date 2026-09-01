// The filed-inspections table. A server component — there is nothing interactive
// on it, and the printable report is a plain link to a route handler.
//
// Shared by both tools for the same reason the form is: a DOT certificate and an
// aerial certificate list identically, and the only column that differs is the
// cadence one, which is switched off for DOT.

import Link from 'next/link'
import type { ShopInspection } from '../types'
import { AERIAL_CADENCE_LABELS } from '../aerial-forms'

function fmtDay(value: string | null): string {
  if (!value) return '—'
  // Noon avoids the timezone slip that turns a date into yesterday.
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function InspectionTable({
  inspections,
  showCadence = false,
}: {
  inspections: ShopInspection[]
  showCadence?: boolean
}) {
  return (
    <div className="nwi-card overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left">
            <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
            {showCadence && (
              <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Cadence</th>
            )}
            <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Unit</th>
            <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Inspector</th>
            <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Result</th>
            <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Deficiencies</th>
            <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Report</th>
          </tr>
        </thead>
        <tbody>
          {inspections.map((inspection) => {
            const failed = inspection.result === 'fail'
            const count = inspection.deficiencies?.length ?? 0
            return (
              <tr key={inspection.id} className="border-b border-slate-100 last:border-b-0">
                <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                  {fmtDay(inspection.signed_at ?? inspection.created_at)}
                </td>
                {showCadence && (
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                    {inspection.cadence ? AERIAL_CADENCE_LABELS[inspection.cadence] : 'Out of cycle'}
                  </td>
                )}
                <td className="px-4 py-3 text-slate-700">{inspection.unit_number || '—'}</td>
                <td className="px-4 py-3 text-slate-700">{inspection.inspector_name}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${
                      failed
                        ? 'bg-red-100 text-red-900 ring-red-300'
                        : 'bg-emerald-100 text-emerald-900 ring-emerald-300'
                    }`}
                  >
                    {failed ? 'FAIL' : 'PASS'}
                  </span>
                  {inspection.removed_from_service && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900 ring-1 ring-amber-300">
                      OUT OF SERVICE
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{count === 0 ? '—' : count}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Link
                    className="font-medium text-slate-900 underline underline-offset-2"
                    href={`/api/shop/inspections/${inspection.id}/report`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Print
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

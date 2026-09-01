'use client'

// The Garage Sync table.
//
// HONESTY IS THE FEATURE HERE. `garage_*` belongs to a different product, and
// the write can fail for reasons this app cannot see or fix — the customer has
// no Garage account, the vehicle has no odometer reading, the tables are not
// reachable. Every one of those comes back from the API with a sentence written
// for a shop manager, and this component prints that sentence verbatim rather
// than collapsing it into "failed". Nothing is ever shown as posted unless the
// API said `posted: true`.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { GarageJobRow } from '@/lib/shop/garage'

interface PostResult {
  posted: boolean
  message: string
  joinUrl: string | null
}

function when(value: string | null): string {
  if (!value) return '—'
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

async function readResult(res: Response): Promise<PostResult> {
  try {
    const body: unknown = await res.json()
    if (body && typeof body === 'object') {
      const b = body as { posted?: unknown; message?: unknown; error?: unknown; joinUrl?: unknown }
      const message =
        typeof b.message === 'string'
          ? b.message
          : typeof b.error === 'string'
            ? b.error
            : 'Something went wrong.'
      return {
        posted: b.posted === true,
        message,
        joinUrl: typeof b.joinUrl === 'string' ? b.joinUrl : null,
      }
    }
  } catch {
    // Fall through.
  }
  return { posted: false, message: 'Something went wrong. Try again.', joinUrl: null }
}

export default function GarageTable({
  rows,
  postingBlocked,
}: {
  rows: GarageJobRow[]
  /** Non-null when nothing can be posted — the message says why. */
  postingBlocked: string | null
}) {
  const router = useRouter()
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, PostResult>>({})
  const [copiedJobId, setCopiedJobId] = useState<string | null>(null)

  async function post(jobId: string) {
    if (busyJobId || postingBlocked) return
    setBusyJobId(jobId)
    try {
      const res = await fetch('/api/shop/torquewrench/garage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      })
      const result = await readResult(res)
      setResults((current) => ({ ...current, [jobId]: result }))
      if (result.posted) router.refresh()
    } catch {
      setResults((current) => ({
        ...current,
        [jobId]: {
          posted: false,
          message: 'Could not reach the server. Check your connection and try again.',
          joinUrl: null,
        },
      }))
    } finally {
      setBusyJobId(null)
    }
  }

  async function copyJoinLink(row: GarageJobRow) {
    const link = results[row.jobId]?.joinUrl ?? row.joinUrl
    try {
      await navigator.clipboard.writeText(link)
      setCopiedJobId(row.jobId)
      window.setTimeout(() => setCopiedJobId(null), 2000)
    } catch {
      // Clipboard access is denied on some locked-down shop tablets. Show the
      // link in the row result so it can still be read off the screen.
      setResults((current) => ({
        ...current,
        [row.jobId]: { posted: false, message: `Copy this link: ${link}`, joinUrl: link },
      }))
    }
  }

  if (rows.length === 0) {
    return (
      <div className="nwi-card p-6 text-center">
        <p className="text-sm font-medium text-slate-700">No invoiced jobs yet</p>
        <p className="mt-1 text-sm text-slate-500">
          A job appears here once it has been invoiced.
        </p>
      </div>
    )
  }

  return (
    <div className="nwi-card overflow-x-auto">
      <table className="w-full min-w-[52rem] text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">Job</th>
            <th scope="col" className="px-4 py-3 font-semibold">Customer</th>
            <th scope="col" className="px-4 py-3 font-semibold">Vehicle</th>
            <th scope="col" className="px-4 py-3 font-semibold">Invoiced</th>
            <th scope="col" className="px-4 py-3 font-semibold">NWI Garage</th>
            <th scope="col" className="px-4 py-3 font-semibold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const result = results[row.jobId]
            const posted = row.postedAt !== null || result?.posted === true

            return (
              <tr key={row.jobId} className="align-top">
                <td className="px-4 py-3 font-mono text-xs text-slate-600">
                  #{row.jobNumber}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{row.customerName}</div>
                  <div className="text-xs text-slate-500">
                    {row.customerEmail ?? 'No email on file'}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-slate-800">{row.vehicleLabel}</div>
                  <div className="text-xs text-slate-500">
                    {row.hasMileage
                      ? `${row.mileage?.toLocaleString('en-US')} mi`
                      : 'No odometer reading'}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">{when(row.invoicedAt)}</td>
                <td className="px-4 py-3">
                  {posted ? (
                    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900 ring-1 ring-inset ring-emerald-400">
                      Posted {row.postedAt ? when(row.postedAt) : ''}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-800 ring-1 ring-inset ring-slate-300">
                      Not posted
                    </span>
                  )}
                  {result && !result.posted ? (
                    <div className="mt-1 max-w-72 text-xs text-slate-600">{result.message}</div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="nwi-btn nwi-btn-secondary"
                      disabled={posted || busyJobId !== null || postingBlocked !== null}
                      onClick={() => post(row.jobId)}
                    >
                      {busyJobId === row.jobId ? 'Posting...' : 'Post to Garage'}
                    </button>
                    <button
                      type="button"
                      className="nwi-btn nwi-btn-secondary"
                      onClick={() => copyJoinLink(row)}
                    >
                      {copiedJobId === row.jobId ? 'Copied' : 'Copy join link'}
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

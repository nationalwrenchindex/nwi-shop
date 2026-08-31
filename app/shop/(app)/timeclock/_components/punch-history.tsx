'use client'

// Punch history with a date-range filter. Loads on mount rather than taking
// server-rendered rows, so every timestamp is formatted in the viewer's own
// timezone with no hydration mismatch.

import { useCallback, useEffect, useState } from 'react'
import { formatHm, punchMinutes } from '@/lib/shop/timeclock'
import type { PunchesResponse } from '@/lib/shop/timeclock'

interface Props {
  defaultFrom: string
  defaultTo: string
  /** Manager view only — the API force-scopes a tech to themselves anyway. */
  techId?: string
}

const EMPTY: PunchesResponse = {
  now: '',
  from: '',
  to: '',
  punches: [],
  jobs: [],
}

function timeOfDay(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return '--'
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function dayLabel(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return '--'
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export default function PunchHistory({ defaultFrom, defaultTo, techId }: Props) {
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [data, setData] = useState<PunchesResponse>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The fetcher touches no state — callers apply the result from the promise
  // callback, which keeps the mount effect free of synchronous setState.
  const fetchRange = useCallback(
    async (fromKey: string, toKey: string): Promise<PunchesResponse | null> => {
      try {
        const params = new URLSearchParams({ from: fromKey, to: toKey })
        if (techId) params.set('tech_id', techId)
        const response = await fetch(`/api/shop/timeclock?${params.toString()}`, {
          cache: 'no-store',
        })
        if (!response.ok) return null
        return (await response.json()) as PunchesResponse
      } catch {
        return null
      }
    },
    [techId],
  )

  useEffect(() => {
    let cancelled = false

    void fetchRange(defaultFrom, defaultTo).then((result) => {
      if (cancelled) return
      if (result) {
        setData(result)
        setError(null)
      } else {
        setError('Could not load history.')
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [fetchRange, defaultFrom, defaultTo])

  const jobNumbers = new Map(data.jobs.map((job) => [job.id, job.job_number]))
  const now = data.now ? new Date(data.now) : new Date()

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold">My history</h2>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setLoading(true)
          setError(null)
          void fetchRange(from, to).then((result) => {
            if (result) setData(result)
            else setError('Could not load history.')
            setLoading(false)
          })
        }}
      >
        <label className="flex flex-col gap-1 text-sm font-semibold">
          From
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          To
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-slate-800 px-5 py-2.5 text-base font-semibold text-white disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
        >
          {loading ? 'Loading...' : 'Show'}
        </button>
      </form>

      {error && (
        <p className="rounded-lg bg-red-100 px-4 py-3 text-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </p>
      )}

      {!loading && data.punches.length === 0 && !error && (
        <p className="rounded-xl border border-dashed border-slate-300 px-5 py-8 text-center text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No punches in this range.
        </p>
      )}

      {data.punches.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full border-collapse text-left text-base">
            <thead className="bg-slate-100 text-xs uppercase tracking-wider dark:bg-slate-900">
              <tr>
                <th className="px-4 py-3 font-semibold">Day</th>
                <th className="px-4 py-3 font-semibold">What</th>
                <th className="px-4 py-3 font-semibold">In</th>
                <th className="px-4 py-3 font-semibold">Out</th>
                <th className="px-4 py-3 text-right font-semibold">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.punches.map((punch) => {
                const open = punch.punch_out === null
                const jobNumber = punch.job_id ? jobNumbers.get(punch.job_id) : undefined
                return (
                  <tr key={punch.id} className={open ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}>
                    <td className="px-4 py-3 whitespace-nowrap">{dayLabel(punch.punch_in)}</td>
                    <td className="px-4 py-3">
                      {punch.type === 'shop'
                        ? 'Shop'
                        : jobNumber !== undefined
                          ? `Job #${jobNumber}`
                          : 'Job'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{timeOfDay(punch.punch_in)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {punch.punch_out ? timeOfDay(punch.punch_out) : 'Open'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                      {formatHm(punchMinutes(punch, now))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

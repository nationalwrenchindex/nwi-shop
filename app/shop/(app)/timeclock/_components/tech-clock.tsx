'use client'

// The wall-tablet screen. Big targets, no ambiguity about what state the clock
// is in, and only ever this one tech's data — the status endpoint scopes a
// `tech` caller to themselves, and this component renders a single entry.

import { useState } from 'react'
import { formatHm, minutesBetween } from '@/lib/shop/timeclock'
import type { JobRef, PunchResult, RosterEntry, StatusResponse } from '@/lib/shop/timeclock'
import { usePolledJson, useTickingNow } from './use-clock'

const POLL_MS = 30_000

type PunchApiResponse = PunchResult | { error: string }

interface PunchRequest {
  action: 'in' | 'out'
  type: 'shop' | 'job'
  job_id?: string
}

interface Props {
  initialStatus: StatusResponse
  jobs: JobRef[]
  /** Whose clock this is. The roster is matched on this, never on position. */
  techId: string
  techName: string
  /** "My jobs" for a tech, "Open jobs" for someone who sees the whole board. */
  jobsHeading: string
}

const EMPTY_ENTRY: RosterEntry = {
  techId: '',
  name: '',
  role: 'tech',
  state: 'out',
  jobId: null,
  jobNumber: null,
  since: null,
  sinceMinutes: 0,
  shopMinutes: 0,
  jobMinutes: 0,
  idleMinutes: 0,
  byJob: [],
  alerts: [],
}

export default function TechClock({
  initialStatus,
  jobs,
  techId,
  techName,
  jobsHeading,
}: Props) {
  const { data: status, stale, refresh } = usePolledJson<StatusResponse>(
    '/api/shop/timeclock/status',
    initialStatus,
    POLL_MS,
  )
  const now = useTickingNow(initialStatus.now)

  const [pending, setPending] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A manager polling this endpoint gets the whole shop back, so pick out the
  // signed-in tech by id — position is not stable across polls.
  const entry = status.roster.find((row) => row.techId === techId) ?? EMPTY_ENTRY
  const onShopClock = entry.state === 'shop' || entry.state === 'job'

  // Live elapsed time: the poll gives us the punch start, the ticking clock
  // counts the seconds between polls so the number never looks frozen.
  const liveSince = entry.since ? minutesBetween(entry.since, now) : 0
  const jobLabel =
    entry.jobNumber !== null
      ? `#${entry.jobNumber}`
      : entry.jobId
        ? 'a job'
        : ''

  async function punch(request: PunchRequest, key: string) {
    setPending(key)
    setNotice(null)
    setError(null)

    try {
      const response = await fetch('/api/shop/timeclock/punch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const payload = (await response.json()) as PunchApiResponse

      if (!response.ok || !('ok' in payload)) {
        setError('error' in payload ? payload.error : 'That punch did not go through.')
      } else {
        setNotice(payload.message)
      }
    } catch {
      setError('No connection — the punch was not recorded. Try again.')
    } finally {
      setPending(null)
      await refresh()
    }
  }

  const banner =
    entry.state === 'job'
      ? {
          text: `On job ${jobLabel} — ${formatHm(liveSince)}`,
          className: 'bg-emerald-600 text-white',
        }
      : entry.state === 'shop'
        ? {
            text: `At shop — ${formatHm(liveSince)}`,
            className: 'bg-sky-600 text-white',
          }
        : {
            text: 'Not in',
            className: 'bg-slate-700 text-slate-100',
          }

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-live="polite"
        className={`rounded-2xl px-6 py-8 text-center shadow-sm ${banner.className}`}
      >
        <p className="text-sm font-semibold uppercase tracking-[0.2em] opacity-80">
          {techName}
        </p>
        <p className="mt-2 text-4xl font-bold sm:text-5xl">{banner.text}</p>
        {entry.state === 'shop' && (
          <p className="mt-2 text-base opacity-90">Not booked to a job right now.</p>
        )}
      </section>

      {(notice ?? error) && (
        <p
          role="status"
          className={`rounded-xl px-5 py-4 text-lg font-medium ${
            error
              ? 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100'
              : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
          }`}
        >
          {error ?? notice}
        </p>
      )}

      <button
        type="button"
        disabled={pending !== null}
        onClick={() =>
          punch({ action: onShopClock ? 'out' : 'in', type: 'shop' }, 'shop')
        }
        className={`w-full rounded-3xl px-6 py-14 text-4xl font-black uppercase tracking-wide text-white shadow-lg transition active:scale-[0.99] disabled:opacity-50 sm:text-5xl ${
          onShopClock
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-emerald-600 hover:bg-emerald-700'
        }`}
      >
        {pending === 'shop'
          ? 'Working...'
          : onShopClock
            ? 'Punch Out'
            : 'Punch In'}
      </button>
      {onShopClock && (
        <p className="-mt-3 text-center text-sm text-slate-600 dark:text-slate-400">
          Punching out for the day also closes any open job punch.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-bold">{jobsHeading}</h2>
          {!onShopClock && (
            <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Punch in at the shop first
            </span>
          )}
        </div>

        {jobs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-5 py-8 text-center text-lg text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No open jobs to punch into.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {jobs.map((job) => {
              const active = entry.jobId === job.id
              const key = `job:${job.id}`
              return (
                <li key={job.id}>
                  <button
                    type="button"
                    disabled={pending !== null || !onShopClock}
                    onClick={() =>
                      punch(
                        active
                          ? { action: 'out', type: 'job', job_id: job.id }
                          : { action: 'in', type: 'job', job_id: job.id },
                        key,
                      )
                    }
                    className={`flex w-full flex-col gap-1 rounded-2xl border-2 px-5 py-6 text-left transition active:scale-[0.99] disabled:opacity-40 ${
                      active
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'
                        : 'border-slate-300 bg-white hover:border-slate-500 dark:border-slate-700 dark:bg-slate-900'
                    }`}
                  >
                    <span className="text-2xl font-bold">#{job.job_number}</span>
                    <span className="line-clamp-2 text-base text-slate-600 dark:text-slate-300">
                      {job.description ?? 'No description'}
                    </span>
                    <span
                      className={`mt-2 text-lg font-bold uppercase tracking-wide ${
                        active ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {pending === key
                        ? 'Working...'
                        : active
                          ? 'Punch off this job'
                          : 'Punch into this job'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-bold">Today</h2>
        <dl className="grid grid-cols-3 gap-3">
          <Stat label="Shop" value={formatHm(entry.shopMinutes)} tone="sky" />
          <Stat label="On jobs" value={formatHm(entry.jobMinutes)} tone="emerald" />
          <Stat label="Idle" value={formatHm(entry.idleMinutes)} tone="amber" />
        </dl>

        {entry.byJob.length > 0 && (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {entry.byJob.map((row) => (
              <li key={row.jobId} className="flex items-center justify-between px-4 py-3">
                <span className="text-lg font-semibold">
                  {row.jobNumber !== null ? `Job #${row.jobNumber}` : 'Job'}
                </span>
                <span className="font-mono text-lg">{formatHm(row.minutes)}</span>
              </li>
            ))}
          </ul>
        )}

        {stale && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Showing the last known status — the connection dropped.
          </p>
        )}
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'sky' | 'emerald' | 'amber'
}) {
  const tones = {
    sky: 'bg-sky-50 text-sky-900 dark:bg-sky-950/50 dark:text-sky-100',
    emerald: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100',
    amber: 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100',
  } as const

  return (
    <div className={`rounded-xl px-4 py-5 text-center ${tones[tone]}`}>
      <dt className="text-xs font-semibold uppercase tracking-widest opacity-75">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-bold sm:text-3xl">{value}</dd>
    </div>
  )
}

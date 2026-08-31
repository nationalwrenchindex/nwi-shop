'use client'

// Dense monitoring table for the whole shop. Polls the status endpoint every
// 30s and ticks the elapsed column every second in between, so the board reads
// as live without hammering the database.

import { formatHm, minutesBetween } from '@/lib/shop/timeclock'
import type { RosterEntry, StatusResponse } from '@/lib/shop/timeclock'
import { usePolledJson, useTickingNow } from '../../_components/use-clock'

const POLL_MS = 30_000

interface Props {
  initialStatus: StatusResponse
  idleThresholdMinutes: number
  noJobThresholdMinutes: number
}

function stateLabel(entry: RosterEntry, elapsed: number): string {
  if (entry.state === 'job') {
    return entry.jobNumber !== null
      ? `On job #${entry.jobNumber} — ${formatHm(elapsed)}`
      : `On a job — ${formatHm(elapsed)}`
  }
  if (entry.state === 'shop') return `At shop — ${formatHm(elapsed)}`
  return 'Not in'
}

function stateDot(entry: RosterEntry): string {
  if (entry.state === 'job') return 'bg-emerald-500'
  if (entry.state === 'shop') return 'bg-sky-500'
  return 'bg-slate-400'
}

export default function RosterBoard({
  initialStatus,
  idleThresholdMinutes,
  noJobThresholdMinutes,
}: Props) {
  const { data: status, stale, refresh } = usePolledJson<StatusResponse>(
    '/api/shop/timeclock/status',
    initialStatus,
    POLL_MS,
  )
  const now = useTickingNow(initialStatus.now)

  const roster = status.roster
  const onShop = roster.filter((entry) => entry.state === 'shop').length
  const onJob = roster.filter((entry) => entry.state === 'job').length
  const out = roster.filter((entry) => entry.state === 'out').length
  const flagged = roster.filter((entry) => entry.alerts.length > 0)

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Floor roster</h2>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500 dark:text-slate-400">
            {onJob} on jobs · {onShop} at shop · {out} out
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
          >
            Refresh
          </button>
        </div>
      </div>

      {stale && (
        <p className="rounded-lg bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Live updates dropped — showing the last roster that loaded.
        </p>
      )}

      {flagged.length > 0 && (
        <div className="rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/40">
          <p className="text-sm font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200">
            {flagged.length} idle {flagged.length === 1 ? 'alert' : 'alerts'}
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-amber-900 dark:text-amber-100">
            {flagged.map((entry) =>
              entry.alerts.map((alert) => (
                <li key={`${entry.techId}:${alert.kind}`}>
                  <span className="font-semibold">{entry.name}</span> — {alert.message}
                </li>
              )),
            )}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase tracking-wider dark:bg-slate-900">
            <tr>
              <th className="px-3 py-2 font-semibold">Tech</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 text-right font-semibold">Shop</th>
              <th className="px-3 py-2 text-right font-semibold">Jobs</th>
              <th className="px-3 py-2 text-right font-semibold">Idle</th>
              <th className="px-3 py-2 font-semibold">Today by job</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {roster.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-slate-500 dark:text-slate-400"
                >
                  No active techs on this shop roster.
                </td>
              </tr>
            )}

            {roster.map((entry) => {
              const elapsed = entry.since
                ? minutesBetween(entry.since, now)
                : entry.sinceMinutes
              const alerted = entry.alerts.length > 0

              return (
                <tr
                  key={entry.techId}
                  className={alerted ? 'bg-amber-50 dark:bg-amber-950/30' : ''}
                >
                  <td className="px-3 py-2 font-semibold whitespace-nowrap">
                    {entry.name}
                    {alerted && (
                      <span className="ml-2 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                        Flag
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={`inline-block size-2 rounded-full ${stateDot(entry)}`}
                      />
                      {stateLabel(entry, elapsed)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                    {formatHm(entry.shopMinutes)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                    {formatHm(entry.jobMinutes)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono whitespace-nowrap ${
                      entry.idleMinutes > idleThresholdMinutes
                        ? 'font-bold text-red-700 dark:text-red-400'
                        : ''
                    }`}
                  >
                    {formatHm(entry.idleMinutes)}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                    {entry.byJob.length === 0
                      ? '—'
                      : entry.byJob
                          .map(
                            (row) =>
                              `${row.jobNumber !== null ? `#${row.jobNumber}` : 'job'} ${formatHm(row.minutes)}`,
                          )
                          .join(' · ')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Flagged at more than {formatHm(idleThresholdMinutes)} idle today, or more than{' '}
        {formatHm(noJobThresholdMinutes)} on the shop clock with no job punch. Refreshes
        every 30 seconds.
      </p>
    </section>
  )
}

// Shop Efficiency Score for the manager dashboard.
//
// Presentational only. Every number arriving here was computed by
// `fetchShopEfficiency` in @/lib/shop/efficiency, so this file and any other
// consumer of that score cannot disagree about what "efficiency" means. Nothing
// is recalculated below except the two purely cosmetic derivations (which color,
// which arrow).
//
// Manager only. The page gates on `permissions.viewFinancials` before rendering
// this — a foreman has `viewAllJobs` but not `viewFinancials`, and billed hours
// are revenue-shaped.

import { efficiencyTone, type ShopEfficiency } from '@/lib/shop/efficiency'

/** The score's color band. `null` (no hours worked) stays neutral slate. */
const SCORE_TONE = {
  good: 'text-emerald-600',
  warn: 'text-amber-600',
  bad:  'text-rose-700',
} as const

/** `12.25` -> `"12.3"`. Hours are shown to one decimal; the shop thinks in
 *  quarter hours and a second decimal is noise on a dashboard. */
function formatHours(hours: number): string {
  return (Math.round(hours * 10) / 10).toFixed(1)
}

/** `+4.2 pts` / `-1.5 pts`. The sign is always explicit so the direction reads
 *  at a glance without comparing to last week's number. */
function formatDelta(points: number): string {
  const sign = points > 0 ? '+' : points < 0 ? '−' : '±'
  return `${sign}${Math.abs(points).toFixed(1)} pts`
}

function Stat({
  label, value, hint, tone = 'text-slate-900',
}: {
  label:  string
  value:  string
  hint?:  string
  tone?:  string
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}

export default function EfficiencyCard({ efficiency }: { efficiency: ShopEfficiency }) {
  const { current, deltaPoints } = efficiency

  const tone = efficiencyTone(current.pct)
  const scoreTone = tone ? SCORE_TONE[tone] : 'text-slate-400'

  // A dash, never NaN or Infinity: `current.pct` is null exactly when the shop
  // has not clocked any hours this week, and a shop with no hours has no score.
  const scoreValue = current.pct === null ? '—' : `${current.pct.toFixed(1)}%`

  // The delta is already null unless BOTH weeks had hours worked, so there is
  // nothing to re-check here. When it is null the line is omitted entirely
  // rather than rendered as "+0%" or "N/A" noise.
  const deltaTone =
    deltaPoints === null || deltaPoints === 0
      ? 'text-slate-500'
      : deltaPoints > 0
        ? 'text-emerald-600'
        : 'text-rose-700'

  return (
    <section className="nwi-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          Shop efficiency
        </h2>
        <p className="text-xs text-slate-500">This week · billed labor vs. hours on the clock</p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Hours worked"
          value={formatHours(current.hoursWorked)}
          hint="Shop clock, open punches included"
        />
        <Stat
          label="Hours billed"
          value={formatHours(current.hoursBilled)}
          hint="Labor on invoiced jobs"
        />
        <Stat
          label="Efficiency score"
          value={scoreValue}
          tone={scoreTone}
          hint={current.pct === null ? 'No hours yet' : 'Billed ÷ worked'}
        />
      </div>

      {deltaPoints === null ? null : (
        <p className={`mt-4 text-xs font-semibold ${deltaTone}`}>
          {formatDelta(deltaPoints)} vs. last week
        </p>
      )}
    </section>
  )
}

'use client'

// Manifold-gauge pressure diagnostic. Pure computation on the server — no model,
// no database, no key. Give it a suction and a discharge reading and it names
// the pressure pattern, what causes it, how to verify it in the field, and what
// to do about it.
//
// The nameplate low/high bounds are optional. Supply them and the classifier
// works against the unit's own spec; leave them blank and it falls back to the
// absolute mid-temp steady-state ranges.

import { useState } from 'react'
import AttachToJob from './attach-to-job'
import { postJson, type GaugeResponse, type JobOption } from './types'

function noteFor(result: GaugeResponse): string {
  const lines = [
    'QuickWrench HD — gauge reading',
    `Suction ${result.readings.actualSuction} PSI (${result.suctionStatus.replace(/_/g, ' ')}), ` +
      `discharge ${result.readings.actualDischarge} PSI (${result.dischargeStatus.replace(/_/g, ' ')})`,
  ]
  if (result.pattern) {
    lines.push(
      '',
      `Pattern: ${result.pattern.patternLabel} (${result.pattern.id})`,
      `Severity: ${result.severity?.label ?? result.pattern.severity}`,
      '',
      'Likely causes:',
      ...result.pattern.causes.map((c) => `- ${c}`),
      '',
      'Field verification:',
      ...result.pattern.fieldVerification.map((c) => `- ${c}`),
      '',
      'Recommended action:',
      ...result.pattern.recommendedAction.map((c) => `- ${c}`),
      '',
      `Labor estimate: ${result.pattern.laborEstimate}`,
    )
    if (result.pattern.refrigerantNote) lines.push(result.pattern.refrigerantNote)
  } else {
    lines.push('', 'No pressure pattern matched these readings.')
  }
  lines.push(
    '',
    'Pressure-pattern reference. Confirm against the unit nameplate and the OEM pressure chart for the current ambient before acting.',
  )
  return lines.join('\n')
}

export default function GaugePanel({ jobs }: { jobs: JobOption[] }) {
  const [suction, setSuction] = useState('')
  const [discharge, setDischarge] = useState('')
  const [suctionLow, setSuctionLow] = useState('')
  const [suctionHigh, setSuctionHigh] = useState('')
  const [dischargeLow, setDischargeLow] = useState('')
  const [dischargeHigh, setDischargeHigh] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GaugeResponse | null>(null)

  function num(value: string): number | undefined {
    const n = Number.parseFloat(value)
    return Number.isFinite(n) ? n : undefined
  }

  async function run() {
    const s = num(suction)
    const d = num(discharge)
    if (s === undefined || d === undefined) {
      setError('Enter both the suction and the discharge reading in PSI.')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await postJson<GaugeResponse>('/api/shop/tools/quickwrench-hd/gauge', {
        actualSuction:   s,
        actualDischarge: d,
        suctionLow:      num(suctionLow),
        suctionHigh:     num(suctionHigh),
        dischargeLow:    num(dischargeLow),
        dischargeHigh:   num(dischargeHigh),
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gauge diagnostic failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="nwi-card p-4 sm:p-5">
        <p className="text-sm leading-relaxed text-slate-600">
          Reads a manifold set against the pressure-pattern matrix. No AI and no
          network lookup — this panel works with every API key removed.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="nwi-label" htmlFor="qwhd-g-suction">Suction PSI</label>
            <input id="qwhd-g-suction" className="nwi-input" inputMode="decimal"
              value={suction} onChange={(e) => setSuction(e.target.value)} />
          </div>
          <div>
            <label className="nwi-label" htmlFor="qwhd-g-discharge">Discharge PSI</label>
            <input id="qwhd-g-discharge" className="nwi-input" inputMode="decimal"
              value={discharge} onChange={(e) => setDischarge(e.target.value)} />
          </div>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            Nameplate ranges (optional — sharpens the classification)
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <div>
              <label className="nwi-label" htmlFor="qwhd-g-sl">Suction low</label>
              <input id="qwhd-g-sl" className="nwi-input" inputMode="decimal"
                value={suctionLow} onChange={(e) => setSuctionLow(e.target.value)} />
            </div>
            <div>
              <label className="nwi-label" htmlFor="qwhd-g-sh">Suction high</label>
              <input id="qwhd-g-sh" className="nwi-input" inputMode="decimal"
                value={suctionHigh} onChange={(e) => setSuctionHigh(e.target.value)} />
            </div>
            <div>
              <label className="nwi-label" htmlFor="qwhd-g-dl">Discharge low</label>
              <input id="qwhd-g-dl" className="nwi-input" inputMode="decimal"
                value={dischargeLow} onChange={(e) => setDischargeLow(e.target.value)} />
            </div>
            <div>
              <label className="nwi-label" htmlFor="qwhd-g-dh">Discharge high</label>
              <input id="qwhd-g-dh" className="nwi-input" inputMode="decimal"
                value={dischargeHigh} onChange={(e) => setDischargeHigh(e.target.value)} />
            </div>
          </div>
        </details>

        <div className="mt-4">
          <button type="button" className="nwi-btn nwi-btn-primary" onClick={run} disabled={busy}>
            {busy ? 'Reading…' : 'Diagnose readings'}
          </button>
        </div>

        {error ? <p className="mt-3 text-sm font-medium text-red-700">{error}</p> : null}
      </section>

      {result ? (
        <div className="space-y-4">
          {result.dangerAlert ? (
            <section className="rounded-xl border border-red-300 bg-red-50 p-4">
              <h3 className="text-sm font-bold uppercase tracking-wide text-red-900">
                Discharge pressure above 400 PSI
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-red-900/90">
                Stop and make the unit safe before continuing. High-side pressure
                at this level is a burn and rupture hazard. Do not open the
                system. Refrigerant work is EPA 608 certified work.
              </p>
            </section>
          ) : null}

          <section className="nwi-card divide-y divide-slate-100">
            <div className="p-4 sm:p-5">
              <p className="text-sm text-slate-600">
                Suction {result.readings.actualSuction} PSI —{' '}
                <span className="font-semibold text-slate-900">
                  {result.suctionStatus.replace(/_/g, ' ')}
                </span>
                {' · '}
                Discharge {result.readings.actualDischarge} PSI —{' '}
                <span className="font-semibold text-slate-900">
                  {result.dischargeStatus.replace(/_/g, ' ')}
                </span>
              </p>
              {result.pattern ? (
                <h3 className="mt-2 text-base font-semibold text-slate-900">
                  {result.pattern.patternLabel}
                  {result.severity ? (
                    <span
                      className="ml-2 rounded px-2 py-0.5 text-xs font-semibold"
                      style={{
                        color:           result.severity.color,
                        backgroundColor: result.severity.bg,
                        border:          `1px solid ${result.severity.border}`,
                      }}
                    >
                      {result.severity.label}
                    </span>
                  ) : null}
                </h3>
              ) : (
                <h3 className="mt-2 text-base font-semibold text-slate-900">
                  No pattern matched these readings
                </h3>
              )}
            </div>

            {result.pattern ? (
              <>
                <GaugeList title="Likely causes" items={result.pattern.causes} />
                <GaugeList title="Verify in the field" items={result.pattern.fieldVerification} />
                <GaugeList title="Recommended action" items={result.pattern.recommendedAction} />
                <div className="p-4 sm:p-5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Labor estimate
                  </h4>
                  <p className="mt-2 text-sm text-slate-800">{result.pattern.laborEstimate}</p>
                  {result.pattern.refrigerantNote ? (
                    <p className="mt-2 text-sm leading-relaxed text-slate-700">
                      {result.pattern.refrigerantNote}
                    </p>
                  ) : null}
                  {result.pattern.recoveryRequired ? (
                    <p className="mt-2 text-sm font-semibold text-red-700">
                      Refrigerant recovery required — EPA 608 certified technician only.
                    </p>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="p-4 sm:p-5">
                <p className="text-sm leading-relaxed text-slate-700">
                  These readings do not fall in any pattern in the matrix. Confirm
                  the gauges are reading correctly and the unit has run long
                  enough to reach steady state, then compare against the OEM
                  pressure chart for the current ambient temperature.
                </p>
              </div>
            )}

            <div className="p-4 sm:p-5">
              <p className="text-xs leading-relaxed text-slate-500">
                Pressure-pattern reference from field experience. It is not a
                substitute for the unit&apos;s own pressure chart — always confirm
                against the nameplate and the OEM chart for the current ambient
                before opening a system or condemning a compressor.
              </p>
            </div>
          </section>

          <section className="nwi-card p-4 sm:p-5">
            <AttachToJob
              jobs={jobs}
              note={noteFor(result)}
              laborDescription={
                result.pattern
                  ? `Reefer gauge diagnosis — ${result.pattern.patternLabel}`
                  : 'Reefer gauge diagnosis'
              }
              enabled
            />
          </section>
        </div>
      ) : null}
    </div>
  )
}

function GaugeList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="p-4 sm:p-5">
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h4>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-relaxed text-slate-800">
            <span aria-hidden className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

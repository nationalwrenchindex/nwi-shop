'use client'

// J1939 fault-code decode. This panel calls a route that does no AI work at all
// — the SPN and FMI tables are shipped data — so it answers instantly and keeps
// answering with every API key removed. That is stated on the panel so a tech
// knows which parts of this tool they can rely on when the shop's connection or
// the AI budget is having a bad day.

import { useState } from 'react'
import { getJson, type FaultResponse } from './types'

export default function FaultPanel() {
  const [spn, setSpn] = useState('')
  const [fmi, setFmi] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FaultResponse | null>(null)

  async function run() {
    if (!spn.trim() && !fmi.trim()) {
      setError('Enter an SPN, an FMI, or both.')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const params = new URLSearchParams()
      if (spn.trim()) params.set('spn', spn.trim())
      if (fmi.trim()) params.set('fmi', fmi.trim())
      setResult(await getJson<FaultResponse>(`/api/shop/tools/quickwrench-hd/fault?${params}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="nwi-card p-4 sm:p-5">
        <p className="text-sm leading-relaxed text-slate-600">
          Decodes an SAE J1939 fault straight from the shipped reference. No AI,
          no network round trip to a model — this works whether or not the shop
          has an AI key.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label className="nwi-label" htmlFor="qwhd-f-spn">SPN</label>
            <input id="qwhd-f-spn" className="nwi-input" inputMode="numeric"
              placeholder="3251" value={spn} onChange={(e) => setSpn(e.target.value)} />
          </div>
          <div>
            <label className="nwi-label" htmlFor="qwhd-f-fmi">FMI</label>
            <input id="qwhd-f-fmi" className="nwi-input" inputMode="numeric"
              placeholder="0" value={fmi} onChange={(e) => setFmi(e.target.value)} />
          </div>
          <button type="button" className="nwi-btn nwi-btn-primary" onClick={run} disabled={busy}>
            {busy ? 'Looking up…' : 'Decode'}
          </button>
        </div>

        {error ? <p className="mt-3 text-sm font-medium text-red-700">{error}</p> : null}
      </section>

      {result ? (
        <section className="nwi-card divide-y divide-slate-100">
          <div className="p-4 sm:p-5">
            <h3 className="text-base font-semibold text-slate-900">{result.label}</h3>
          </div>

          {result.spn ? (
            <div className="p-4 sm:p-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                SPN {result.spn.spn} — what is faulted
              </h4>
              <p className="mt-2 text-sm text-slate-800">{result.spn.meaning}</p>
            </div>
          ) : null}

          {result.fmi ? (
            <div className="p-4 sm:p-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                FMI {result.fmi.fmi} — how it failed
              </h4>
              <p className="mt-2 text-sm text-slate-800">{result.fmi.meaning}</p>
              <p className="mt-2 text-sm text-slate-600">{result.fmi.fieldAdvice}</p>
            </div>
          ) : null}

          {result.fieldRule ? (
            <div className="p-4 sm:p-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Field rule</h4>
              <p className="mt-2 text-sm text-slate-800">{result.fieldRule}</p>
            </div>
          ) : null}

          {result.unknown.length > 0 ? (
            <div className="p-4 sm:p-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-700">
                Not in the offline reference
              </h4>
              {result.unknown.map((line) => (
                <p key={line} className="mt-2 text-sm leading-relaxed text-slate-700">{line}</p>
              ))}
            </div>
          ) : null}

          <div className="p-4 sm:p-5">
            <p className="text-xs leading-relaxed text-slate-500">{result.disclaimer}</p>
          </div>
        </section>
      ) : null}
    </div>
  )
}

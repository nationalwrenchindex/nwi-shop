'use client'

// The two ways a light-duty job starts: a code came off the scanner, or the
// customer described something. Both post to the same route.

import { useState } from 'react'
import { isValidDtc, type LdDiagnoseResponse } from '@/lib/shop/quickwrench/ld'
import { LD_API, postJson } from './client-api'
import { vehicleIsIdentified, type WorkVehicle } from './types'
import { Notice, Panel, Spinner } from './ui'

export default function DiagnosePanel({
  vehicle,
  aiEnabled,
  onResult,
}: {
  vehicle:   WorkVehicle
  aiEnabled: boolean
  onResult:  (payload: LdDiagnoseResponse) => void
}) {
  const [code, setCode] = useState('')
  const [display, setDisplay] = useState('')
  const [symptom, setSymptom] = useState('')
  const [busy, setBusy] = useState<null | 'code' | 'symptom'>(null)
  const [error, setError] = useState<string | null>(null)

  const identified = vehicleIsIdentified(vehicle)

  async function run(mode: 'code' | 'symptom') {
    setError(null)

    const trimmedCode = code.trim().toUpperCase()
    if (mode === 'code' && !isValidDtc(trimmedCode)) {
      setError('Enter a DTC as a letter P, B, C or U followed by four digits, e.g. P0420.')
      return
    }
    if (mode === 'symptom' && symptom.trim() === '') {
      setError('Describe what the vehicle is doing.')
      return
    }

    setBusy(mode)
    const result = await postJson<LdDiagnoseResponse>(`${LD_API}/diagnose`, {
      code:           mode === 'code' ? trimmedCode : '',
      displayMessage: display,
      symptom:        mode === 'symptom' ? symptom : '',
      year:           vehicle.year,
      make:           vehicle.make,
      model:          vehicle.model,
      engine:         vehicle.engine,
    })
    setBusy(null)

    if (!result.ok) {
      setError(result.error)
      return
    }
    onResult(result.data)
  }

  return (
    <Panel
      title="Diagnose"
      subtitle="Look up a code, or work from what the customer described."
    >
      <div className="space-y-5">
        {!aiEnabled ? (
          <Notice tone="warning" title="Diagnostics are switched off">
            GEMINI_API_KEY is not set on this deployment, so code and symptom
            diagnosis cannot run. Recalls, complaints and VIN decode below still work.
          </Notice>
        ) : null}

        {aiEnabled && !identified ? (
          <Notice tone="info">
            Fill in the year, make and model above first. A code means different
            things on different vehicles, and a generic answer is the wrong answer.
          </Notice>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div>
              <label className="nwi-label" htmlFor="qwld-code">DTC code</label>
              <input
                id="qwld-code"
                className="nwi-input font-mono uppercase"
                placeholder="P0420"
                maxLength={5}
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>
            <div>
              <label className="nwi-label" htmlFor="qwld-display">Dash message (optional)</label>
              <input
                id="qwld-display"
                className="nwi-input"
                placeholder="Service Engine Soon, reduced power…"
                value={display}
                onChange={(e) => setDisplay(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="nwi-btn nwi-btn-primary w-full"
              onClick={() => run('code')}
              disabled={!aiEnabled || !identified || busy !== null}
            >
              {busy === 'code' ? 'Looking up…' : 'Look up code'}
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="nwi-label" htmlFor="qwld-symptom">Symptom</label>
              <textarea
                id="qwld-symptom"
                className="nwi-input min-h-[7.5rem] resize-y"
                placeholder="Shudders between 40 and 50 mph under light throttle, no codes stored."
                value={symptom}
                onChange={(e) => setSymptom(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="nwi-btn nwi-btn-primary w-full"
              onClick={() => run('symptom')}
              disabled={!aiEnabled || !identified || busy !== null}
            >
              {busy === 'symptom' ? 'Diagnosing…' : 'Diagnose symptom'}
            </button>
          </div>
        </div>

        {busy ? <Spinner label="Searching and reasoning — this can take up to a minute." /> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </div>
    </Panel>
  )
}

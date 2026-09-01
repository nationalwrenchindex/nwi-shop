'use client'

// The AI half of Trailer ABS. Everything here degrades to a clear notice when
// GEMINI_API_KEY is absent — the form is disabled rather than failing when pressed, and
// the reference browser above keeps working in full.
//
// THREE THINGS THIS COMPONENT WILL NOT DO, all of them safety rules and not style:
//   1. It never renders a fault description the route did not commit to. A low-confidence
//      answer comes back with an empty fault_description and this shows the clarification
//      question instead — it does not fill the gap with the steps' first sentence.
//   2. It never puts a model-authored number on a labor line. The hours in the estimate
//      come from the hand-owned table in @/lib/shop/trailer/abs-labor, and the line item
//      it posts uses that table's own wording, not the model's.
//   3. It never lets the disclaimer scroll away from the result. Every rendered
//      diagnostic carries it.

import { useState } from 'react'
import {
  ABS_AI_DISCLAIMER,
  ABS_MANUFACTURERS,
  ABS_MANUFACTURER_LABELS,
  type ABSDiagnosticResponse,
  type ABSManufacturer,
} from '@/lib/shop/trailer/abs-diagnostic-contract'
import type { JobStatus } from '@/lib/types'

export interface AttachableJob {
  id:          string
  job_number:  number
  status:      JobStatus
  description: string | null
}

type AttachState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string }

export default function AbsDiagnostic({
  geminiReady,
  jobs,
  techId,
}: {
  geminiReady: boolean
  jobs: AttachableJob[]
  techId: string
}) {
  const [manufacturer, setManufacturer] = useState<ABSManufacturer>('wabco')
  const [ecuGeneration, setEcuGeneration] = useState('')
  const [blinkCode, setBlinkCode] = useState('')
  const [symptoms, setSymptoms] = useState('')
  const [clarificationAnswer, setClarificationAnswer] = useState('')
  const [trailerRef, setTrailerRef] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ABSDiagnosticResponse | null>(null)

  const [jobId, setJobId] = useState('')
  const [hoursChoice, setHoursChoice] = useState<'low' | 'high'>('low')
  const [attach, setAttach] = useState<AttachState>({ kind: 'idle' })

  const canSubmit =
    geminiReady && !loading && (blinkCode.trim().length > 0 || symptoms.trim().length > 0)

  async function runDiagnostic(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setLoading(true)
    setError(null)
    setAttach({ kind: 'idle' })

    try {
      const res = await fetch('/api/shop/tools/trailer-abs/diagnostic', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manufacturer,
          ecu_generation:       ecuGeneration,
          blink_code:           blinkCode,
          symptoms,
          clarification_answer: clarificationAnswer,
        }),
      })

      const body: unknown = await res.json()

      if (!res.ok) {
        const message =
          body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : 'The diagnostic could not be run.'
        setError(message)
        setResult(null)
        return
      }

      setResult(body as ABSDiagnosticResponse)
    } catch {
      setError('Could not reach the server. Nothing has been diagnosed.')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  /** The plain-text record of what was run and what came back, for the job notes. */
  function noteBlock(res: ABSDiagnosticResponse): string {
    const stamp = new Date().toLocaleString()
    const lines: string[] = [
      `--- Trailer ABS diagnostic (${stamp}) ---`,
      `ABS: ${ABS_MANUFACTURER_LABELS[manufacturer]}${ecuGeneration ? ` / ECU ${ecuGeneration}` : ''}`,
    ]
    if (trailerRef.trim()) lines.push(`Trailer: ${trailerRef.trim()}`)
    if (blinkCode.trim()) lines.push(`Blink code as flashed: ${blinkCode.trim()}`)
    if (symptoms.trim()) lines.push(`Symptoms: ${symptoms.trim()}`)
    if (res.fault_description) lines.push('', `Fault (AI-assisted): ${res.fault_description}`)
    if (res.clarification_needed && res.clarification_question) {
      lines.push('', `NOT CONFIRMED — outstanding question: ${res.clarification_question}`)
    }
    if (res.diagnostic_steps.length) {
      lines.push('', 'Steps:', ...res.diagnostic_steps.map((s, i) => `${i + 1}. ${s}`))
    }
    if (res.specs_to_check.length) {
      lines.push('', 'Specs to check:', ...res.specs_to_check.map((s) => `- ${s}`))
    }
    if (res.labor_estimate) {
      lines.push(
        '',
        `Book time (shop table, not AI): ${res.labor_estimate.low_hours}-${res.labor_estimate.high_hours} hrs — ${res.labor_estimate.description}`,
      )
    }
    lines.push('', ABS_AI_DISCLAIMER)
    return lines.join('\n')
  }

  async function attachToNotes() {
    if (!result || !jobId) return
    setAttach({ kind: 'working' })
    try {
      // Read first so the append does not clobber whatever is already on the job.
      const readRes = await fetch(`/api/shop/jobs/${jobId}`, { cache: 'no-store' })
      if (!readRes.ok) {
        setAttach({ kind: 'failed', message: 'Could not open that job.' })
        return
      }
      const detail = (await readRes.json()) as { job: { notes: string | null } }
      const existing = detail.job.notes?.trim() ?? ''
      const next = existing ? `${existing}\n\n${noteBlock(result)}` : noteBlock(result)

      const writeRes = await fetch(`/api/shop/jobs/${jobId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ notes: next }),
      })
      if (!writeRes.ok) {
        const body: unknown = await writeRes.json().catch(() => null)
        const message =
          body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : 'Could not write to the job notes.'
        setAttach({ kind: 'failed', message })
        return
      }
      setAttach({ kind: 'done', message: 'Added to the job notes.' })
    } catch {
      setAttach({ kind: 'failed', message: 'Could not reach the server. Nothing was written.' })
    }
  }

  async function attachLaborLine() {
    if (!result?.labor_estimate || !jobId) return
    const entry = result.labor_estimate
    const hours = hoursChoice === 'low' ? entry.low_hours : entry.high_hours

    setAttach({ kind: 'working' })
    try {
      const res = await fetch(`/api/shop/jobs/${jobId}/line-items`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:        'labor',
          // The table's own wording, not the model's. Nothing a language model wrote
          // reaches an invoice line from here.
          description: entry.description,
          part_number: null,
          quantity:    hours,
          unit_cost:   0,
          // unit_price omitted on purpose: the jobs route bills labor at the shop's own
          // labor rate when no price is sent, which is the correct number and is not
          // this component's to decide.
          inventory_id: null,
          tech_id:      techId,
        }),
      })
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null)
        const message =
          body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : 'Could not add the labor line.'
        setAttach({ kind: 'failed', message })
        return
      }
      setAttach({
        kind: 'done',
        message: `Added ${hours} hr of labor to the job. Check the rate and the hours before it is invoiced.`,
      })
    } catch {
      setAttach({ kind: 'failed', message: 'Could not reach the server. Nothing was added.' })
    }
  }

  return (
    <section className="nwi-card p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-slate-900">ABS Blink-Code Diagnostic</h2>
      <p className="mt-1 text-sm text-slate-600">
        AI-assisted. It asks rather than guesses: without the ECU generation it will not
        read a blink code, because the same flash pattern means different things on
        different generations.
      </p>

      {!geminiReady ? (
        // Deliberately NOT .nwi-card — that rule is unlayered CSS and would override the
        // amber background.
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
          <h3 className="text-base font-semibold text-amber-900">
            AI diagnostic not configured
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
            This deployment has no Gemini API key set, so the diagnostic below cannot run.
            Nothing is broken and nothing is missing from your plan — the key has not been
            added yet.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
            The Trailer Reference above is unaffected and works in full, including the ABS
            blink-code rows, the wheel speed sensor specs and the J560 pin-out. Read the
            code off the ECU decal and look it up there.
          </p>
        </div>
      ) : null}

      <form onSubmit={runDiagnostic} className="mt-4 space-y-4">
        <fieldset disabled={!geminiReady} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="abs-manufacturer" className="nwi-label">
                ABS manufacturer
              </label>
              <select
                id="abs-manufacturer"
                className="nwi-select"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value as ABSManufacturer)}
              >
                {ABS_MANUFACTURERS.map((value) => (
                  <option key={value} value={value}>
                    {ABS_MANUFACTURER_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="abs-ecu-generation" className="nwi-label">
                ECU generation (off the housing decal)
              </label>
              <input
                id="abs-ecu-generation"
                className="nwi-input"
                placeholder="TEBS-E, Gen 5, TABS-6…"
                value={ecuGeneration}
                onChange={(e) => setEcuGeneration(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div>
              <label htmlFor="abs-blink-code" className="nwi-label">
                Blink code as flashed
              </label>
              <input
                id="abs-blink-code"
                className="nwi-input"
                placeholder="1-1, 4-2, 6 flashes…"
                value={blinkCode}
                onChange={(e) => setBlinkCode(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div>
              <label htmlFor="abs-trailer-ref" className="nwi-label">
                Trailer (optional, for the job record)
              </label>
              <input
                id="abs-trailer-ref"
                className="nwi-input"
                placeholder="Unit number or VIN"
                value={trailerRef}
                onChange={(e) => setTrailerRef(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div>
            <label htmlFor="abs-symptoms" className="nwi-label">
              Symptoms
            </label>
            <textarea
              id="abs-symptoms"
              className="nwi-input"
              rows={3}
              placeholder="ABS lamp stays on after the self-check, no wheel lock on the curb-side rear…"
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
            />
          </div>

          {result?.clarification_needed ? (
            <div>
              <label htmlFor="abs-clarification" className="nwi-label">
                Answer to the question above
              </label>
              <input
                id="abs-clarification"
                className="nwi-input"
                placeholder="What the ECU housing decal actually says"
                value={clarificationAnswer}
                onChange={(e) => setClarificationAnswer(e.target.value)}
                autoComplete="off"
              />
            </div>
          ) : null}

          <p className="text-sm text-slate-500">
            Enter a blink code, symptoms, or both.
          </p>

          <button type="submit" className="nwi-btn nwi-btn-primary" disabled={!canSubmit}>
            {loading ? 'Working…' : 'Run diagnostic'}
          </button>
        </fieldset>
      </form>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-6 space-y-4 border-t border-slate-200 pt-6">
          {result.clarification_needed && result.clarification_question ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-base font-semibold text-amber-900">
                Not confirmed — one thing is needed first
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
                {result.clarification_question}
              </p>
            </div>
          ) : null}

          {result.fault_description ? (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Fault
              </h3>
              <p className="mt-2 text-base leading-relaxed text-slate-900">
                {result.fault_description}
              </p>
            </div>
          ) : null}

          <StepList title="Diagnostic steps" items={result.diagnostic_steps} ordered />
          <StepList title="Specs to check" items={result.specs_to_check} />
          <StepList title="Tools needed" items={result.tools_needed} />

          {result.labor_estimate ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Book time
              </h3>
              <p className="mt-2 text-base font-semibold text-slate-900">
                {result.labor_estimate.low_hours}–{result.labor_estimate.high_hours} hours
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">
                {result.labor_estimate.description}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                From the shop&apos;s own labor table, not from the AI. The AI never
                supplies an hours figure. It is a band, not a quote — an accessible wheel
                end is not the same job as a seized sensor behind a mud-caked drum.
              </p>
            </div>
          ) : null}

          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-900">
            {ABS_AI_DISCLAIMER}
          </p>

          <AttachToJob
            jobs={jobs}
            jobId={jobId}
            onJobChange={(value) => {
              setJobId(value)
              setAttach({ kind: 'idle' })
            }}
            hoursChoice={hoursChoice}
            onHoursChange={setHoursChoice}
            hasLabor={result.labor_estimate !== null}
            laborLow={result.labor_estimate?.low_hours ?? null}
            laborHigh={result.labor_estimate?.high_hours ?? null}
            state={attach}
            onAttachNotes={attachToNotes}
            onAttachLabor={attachLaborLine}
          />
        </div>
      ) : null}
    </section>
  )
}

function StepList({
  title,
  items,
  ordered = false,
}: {
  title: string
  items: string[]
  ordered?: boolean
}) {
  if (items.length === 0) return null
  const List = ordered ? 'ol' : 'ul'
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <List
        className={
          ordered
            ? 'mt-2 list-decimal space-y-2 pl-5 text-base leading-relaxed text-slate-800'
            : 'mt-2 list-disc space-y-2 pl-5 text-base leading-relaxed text-slate-800'
        }
      >
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </List>
    </div>
  )
}

function AttachToJob({
  jobs,
  jobId,
  onJobChange,
  hoursChoice,
  onHoursChange,
  hasLabor,
  laborLow,
  laborHigh,
  state,
  onAttachNotes,
  onAttachLabor,
}: {
  jobs: AttachableJob[]
  jobId: string
  onJobChange: (value: string) => void
  hoursChoice: 'low' | 'high'
  onHoursChange: (value: 'low' | 'high') => void
  hasLabor: boolean
  laborLow: number | null
  laborHigh: number | null
  state: AttachState
  onAttachNotes: () => void
  onAttachLabor: () => void
}) {
  const busy = state.kind === 'working'

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Attach to a job
      </h3>

      {jobs.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">
          No open jobs to attach this to.
        </p>
      ) : (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="abs-attach-job" className="nwi-label">
                Job
              </label>
              <select
                id="abs-attach-job"
                className="nwi-select"
                value={jobId}
                onChange={(e) => onJobChange(e.target.value)}
              >
                <option value="">Choose a job…</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    #{job.job_number} — {job.description ?? 'No description'} ({job.status})
                  </option>
                ))}
              </select>
            </div>

            {hasLabor ? (
              <div>
                <label htmlFor="abs-attach-hours" className="nwi-label">
                  Hours to bill
                </label>
                <select
                  id="abs-attach-hours"
                  className="nwi-select"
                  value={hoursChoice}
                  onChange={(e) => onHoursChange(e.target.value === 'high' ? 'high' : 'low')}
                >
                  <option value="low">{laborLow} hr (low end of the band)</option>
                  <option value="high">{laborHigh} hr (high end of the band)</option>
                </select>
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="nwi-btn nwi-btn-secondary"
              disabled={!jobId || busy}
              onClick={onAttachNotes}
            >
              {busy ? 'Working…' : 'Add to job notes'}
            </button>
            {hasLabor ? (
              <button
                type="button"
                className="nwi-btn nwi-btn-primary"
                disabled={!jobId || busy}
                onClick={onAttachLabor}
              >
                {busy ? 'Working…' : 'Add labor line'}
              </button>
            ) : null}
          </div>

          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            The notes record what was entered and what came back, including the disclaimer.
            A labor line bills the hours from the shop labor table at the shop&apos;s own
            rate — check it before the job is invoiced.
          </p>
        </>
      )}

      {state.kind === 'done' ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {state.message}
        </p>
      ) : null}
      {state.kind === 'failed' ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {state.message}
        </p>
      ) : null}
    </div>
  )
}

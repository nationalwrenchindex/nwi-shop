'use client'

// The shop-native half of QuickWrench LD: get the finding off the screen and
// onto the job, where it reaches the invoice and the customer.
//
// Two actions, both against the jobs API this tool does not own:
//   - append the diagnostic to the job's notes  (PATCH /api/shop/jobs/[id])
//   - add a labor line                          (POST  .../line-items)
//
// The labor line deliberately sends no `unit_cost`. Cost is a margin field and
// the line-items route only accepts one from a caller with `viewMargins`; there
// is no cost to send here anyway, and labor with no explicit price bills at the
// shop's own labor rate server-side. Hours are typed by the tech rather than
// scraped out of the model's prose — an invented book time on a real invoice is
// exactly the kind of guess this tool must not make.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDiagnosticForNotes, type LdDiagnostic } from '@/lib/shop/quickwrench/ld'
import { patchJson, postJson } from './client-api'
import { JOB_STATUS_LABELS, type JobOption, type WorkVehicle } from './types'
import { Notice, Panel } from './ui'

export default function AttachToJob({
  jobs,
  result,
  vehicle,
}: {
  jobs:    JobOption[]
  result:  LdDiagnostic | null
  vehicle: WorkVehicle
}) {
  const router = useRouter()

  const [jobId, setJobId] = useState('')
  const [hours, setHours] = useState('1.0')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState<null | 'notes' | 'labor'>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // Notes we have already written this session, so a second save appends to the
  // current text rather than clobbering the first one.
  const [localNotes, setLocalNotes] = useState<Record<string, string>>({})

  const job = jobs.find((j) => j.id === jobId) ?? null

  function selectJob(id: string) {
    setJobId(id)
    setError(null)
    setDone(null)
    if (description.trim() === '' && result) {
      setDescription(defaultLaborDescription(result))
    }
  }

  async function saveToNotes() {
    if (!job || !result) return
    setBusy('notes')
    setError(null)
    setDone(null)

    const current = localNotes[job.id] ?? job.notes ?? ''
    const block = formatDiagnosticForNotes(result, vehicle)
    const next = current.trim() === '' ? block : `${current.trim()}\n\n---\n\n${block}`

    const res = await patchJson<unknown>(`/api/shop/jobs/${job.id}`, { notes: next })
    setBusy(null)

    if (!res.ok) {
      setError(res.error)
      return
    }
    setLocalNotes((prev) => ({ ...prev, [job.id]: next }))
    setDone(`Saved to the notes on job #${job.job_number}.`)
    router.refresh()
  }

  async function addLabor() {
    if (!job) return
    const qty = Number(hours)
    const desc = description.trim()

    setError(null)
    setDone(null)

    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Enter the labor hours as a number greater than zero.')
      return
    }
    if (desc === '') {
      setError('Describe the labor being billed.')
      return
    }

    setBusy('labor')
    const res = await postJson<unknown>(`/api/shop/jobs/${job.id}/line-items`, {
      type:        'labor',
      description: desc,
      quantity:    qty,
    })
    setBusy(null)

    if (!res.ok) {
      setError(res.error)
      return
    }
    setDone(`Added ${qty} h of labor to job #${job.job_number} at the shop labor rate.`)
    router.refresh()
  }

  if (jobs.length === 0) {
    return (
      <Panel title="Attach to a job">
        <Notice tone="info">
          You have no open jobs to attach this to. Start a job on the job board
          first, then come back.
        </Notice>
      </Panel>
    )
  }

  return (
    <Panel
      title="Attach to a job"
      subtitle="Put the finding on the work order so it reaches the invoice."
    >
      <div className="space-y-4">
        <div>
          <label className="nwi-label" htmlFor="qwld-job">Job</label>
          <select
            id="qwld-job"
            className="nwi-select"
            value={jobId}
            onChange={(e) => selectJob(e.target.value)}
          >
            <option value="">Select an open job</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                #{j.job_number} · {JOB_STATUS_LABELS[j.status]} · {j.summary}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-900">Save the diagnostic to notes</p>
          <p className="mt-1 text-sm text-slate-500">
            Appends the full result, its sources and the verify-before-you-wrench
            warning to the job notes. Nothing already in the notes is removed.
          </p>
          <button
            type="button"
            className="nwi-btn nwi-btn-primary mt-3"
            onClick={saveToNotes}
            disabled={!job || !result || busy !== null}
          >
            {busy === 'notes' ? 'Saving…' : 'Save to job notes'}
          </button>
          {!result ? (
            <p className="mt-2 text-xs text-slate-500">Run a diagnosis first.</p>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-900">Add a labor line</p>
          <p className="mt-1 text-sm text-slate-500">
            Billed at your shop labor rate. Set the hours yourself — the AI estimate
            is a starting point, not book time.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_8rem]">
            <div>
              <label className="nwi-label" htmlFor="qwld-labor-desc">Description</label>
              <input
                id="qwld-labor-desc"
                className="nwi-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Diagnose and repair…"
              />
            </div>
            <div>
              <label className="nwi-label" htmlFor="qwld-labor-hours">Hours</label>
              <input
                id="qwld-labor-hours"
                className="nwi-input"
                inputMode="decimal"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </div>
          </div>
          {result?.labor_estimate ? (
            <p className="mt-2 text-xs text-slate-500">
              AI estimate for reference: {result.labor_estimate}
            </p>
          ) : null}
          <button
            type="button"
            className="nwi-btn nwi-btn-primary mt-3"
            onClick={addLabor}
            disabled={!job || busy !== null}
          >
            {busy === 'labor' ? 'Adding…' : 'Add labor line'}
          </button>
        </div>

        {error ? <Notice tone="danger">{error}</Notice> : null}
        {done ? <Notice tone="info">{done}</Notice> : null}
      </div>
    </Panel>
  )
}

/** A labor description a service writer would recognise, from the diagnostic. */
function defaultLaborDescription(result: LdDiagnostic): string {
  if (result.suggested_repair) return result.suggested_repair.slice(0, 200)
  if (result.code && result.code !== 'NO-CODE') {
    return `Diagnose ${result.code}${result.name ? ` — ${result.name}` : ''}`
  }
  return result.name ? `Diagnose — ${result.name}` : 'Diagnostic labor'
}

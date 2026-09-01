'use client'

// Pushes a finished diagnostic onto an open job — either appended to the job's
// notes, or as a labor line on the invoice.
//
// Both destinations are EXISTING routes owned elsewhere in the app and are used
// exactly as documented, never modified:
//   PATCH /api/shop/jobs/[id]              { notes }
//   POST  /api/shop/jobs/[id]/line-items   { type, description, quantity, unit_price, ... }
//
// Notes are appended, never replaced: the note field is shared with whoever else
// is working the job, and silently overwriting another tech's write-up would be
// a data-loss bug wearing a feature's clothes. We re-read the job immediately
// before the PATCH so the append is against current content.

import { useState } from 'react'
import type { JobOption } from './types'

interface Props {
  jobs: JobOption[]
  /** The block of text to append to the job's notes. */
  note: string
  /** Default description for a labor line. */
  laborDescription: string
  /** False while the result on screen is not something to act on. */
  enabled: boolean
}

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'ok'; message: string } | { kind: 'error'; message: string }

export default function AttachToJob({ jobs, note, laborDescription, enabled }: Props) {
  const [jobId, setJobId] = useState('')
  const [hours, setHours] = useState('1.0')
  const [rate, setRate] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  if (jobs.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No open jobs to attach this to. Start a job on the board first.
      </p>
    )
  }

  async function saveToNotes() {
    if (!jobId) return
    setStatus({ kind: 'busy' })
    try {
      const readRes = await fetch(`/api/shop/jobs/${jobId}`)
      if (!readRes.ok) throw new Error('Could not read that job.')
      const detail: { job?: { notes?: string | null } } = await readRes.json()
      const existing = detail.job?.notes?.trim() ?? ''
      const merged = existing ? `${existing}\n\n${note}` : note

      const res = await fetch(`/api/shop/jobs/${jobId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ notes: merged }),
      })
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not save to that job.')
      }
      setStatus({ kind: 'ok', message: 'Saved to the job notes.' })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Save failed.' })
    }
  }

  async function addLaborLine() {
    if (!jobId) return
    const quantity = Number.parseFloat(hours)
    const unitPrice = Number.parseFloat(rate)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setStatus({ kind: 'error', message: 'Enter the hours as a number greater than zero.' })
      return
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setStatus({ kind: 'error', message: 'Enter an hourly rate.' })
      return
    }

    setStatus({ kind: 'busy' })
    try {
      // `total` is computed server-side — we deliberately do not send one.
      const res = await fetch(`/api/shop/jobs/${jobId}/line-items`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type:        'labor',
          description: laborDescription,
          quantity,
          unit_price:  unitPrice,
        }),
      })
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not add the labor line.')
      }
      setStatus({ kind: 'ok', message: 'Labor line added to the job.' })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not add the line.' })
    }
  }

  const busy = status.kind === 'busy'

  return (
    <div className="space-y-3">
      <div>
        <label className="nwi-label" htmlFor="qwhd-job">Attach to job</label>
        <select
          id="qwhd-job"
          className="nwi-select"
          value={jobId}
          onChange={(e) => { setJobId(e.target.value); setStatus({ kind: 'idle' }) }}
          disabled={!enabled || busy}
        >
          <option value="">Select an open job…</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>{job.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="nwi-btn nwi-btn-secondary"
          onClick={saveToNotes}
          disabled={!enabled || !jobId || busy}
        >
          Save to job notes
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className="nwi-label" htmlFor="qwhd-hours">Labor hours</label>
          <input
            id="qwhd-hours"
            className="nwi-input"
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            disabled={!enabled || busy}
          />
        </div>
        <div>
          <label className="nwi-label" htmlFor="qwhd-rate">Rate per hour</label>
          <input
            id="qwhd-rate"
            className="nwi-input"
            inputMode="decimal"
            placeholder="0.00"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            disabled={!enabled || busy}
          />
        </div>
        <button
          type="button"
          className="nwi-btn nwi-btn-secondary"
          onClick={addLaborLine}
          disabled={!enabled || !jobId || busy}
        >
          Add labor line
        </button>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        Labor hours here are yours to set. Any book time quoted in a diagnostic is
        a reference figure, not a rate this tool will bill on your behalf.
      </p>

      {status.kind === 'ok' ? (
        <p className="text-sm font-medium text-emerald-700">{status.message}</p>
      ) : null}
      {status.kind === 'error' ? (
        <p className="text-sm font-medium text-red-700">{status.message}</p>
      ) : null}
    </div>
  )
}

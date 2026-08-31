'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LOCATION_LABELS, formatMoney, type PartView } from '@/lib/shop/inventory'
import Modal from './modal'

interface UsePartDialogProps {
  parts:         PartView[]
  initialPartId: string
  onClose:       () => void
}

interface JobOption {
  id:          string
  job_number:  number
  description: string | null
  status:      string
}

const CLOSED_STATUSES = new Set(['completed', 'invoiced'])

/**
 * Reads whatever GET /api/shop/jobs returns without assuming its envelope —
 * that route belongs to the jobs area, so this is deliberately tolerant of
 * `[...]`, `{ jobs: [...] }` or `{ data: [...] }`.
 */
function parseJobs(payload: unknown): JobOption[] {
  const list = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null
      ? ((payload as Record<string, unknown>).jobs ?? (payload as Record<string, unknown>).data)
      : null

  if (!Array.isArray(list)) return []

  const jobs: JobOption[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    if (typeof row.id !== 'string') continue
    if (row.voided === true) continue

    const status = typeof row.status === 'string' ? row.status : 'estimate'
    if (CLOSED_STATUSES.has(status)) continue

    jobs.push({
      id:          row.id,
      job_number:  typeof row.job_number === 'number' ? row.job_number : 0,
      description: typeof row.description === 'string' ? row.description : null,
      status,
    })
  }
  return jobs.sort((a, b) => b.job_number - a.job_number)
}

export default function UsePartDialog({ parts, initialPartId, onClose }: UsePartDialogProps) {
  const router = useRouter()

  const [partId, setPartId] = useState(initialPartId)
  const [jobId, setJobId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [notes, setNotes] = useState('')

  const [jobs, setJobs] = useState<JobOption[]>([])
  const [jobsState, setJobsState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const response = await fetch('/api/shop/jobs', { headers: { Accept: 'application/json' } })
        if (!response.ok) throw new Error(String(response.status))
        const payload: unknown = await response.json()
        if (cancelled) return
        setJobs(parseJobs(payload))
        setJobsState('ready')
      } catch {
        if (!cancelled) setJobsState('failed')
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const part = parts.find((p) => p.id === partId) ?? null
  const requested = Number(quantity) || 0
  const short = part !== null && requested > part.quantity_on_hand

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/shop/inventory/use', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          inventory_id: partId,
          job_id:       jobId,
          quantity:     requested,
          notes:        notes || null,
        }),
      })
      const result: { error?: string } = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(result.error ?? 'Could not use the part.')
        return
      }

      onClose()
      router.refresh()
    } catch {
      setError('Network error — nothing was changed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Use part on a job"
      subtitle="Takes the stock down, records the movement, and bills the part to the job."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="nwi-label" htmlFor="use-job">Job</label>
          {jobsState === 'failed' ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              The job list could not be loaded. Open the job board and try again.
            </p>
          ) : (
            <select
              id="use-job"
              className="nwi-select"
              required
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              disabled={jobsState === 'loading'}
            >
              <option value="">
                {jobsState === 'loading'
                  ? 'Loading open jobs…'
                  : jobs.length === 0
                    ? 'No open jobs'
                    : 'Select a job…'}
              </option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  #{job.job_number}
                  {job.description ? ` — ${job.description}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="nwi-label" htmlFor="use-part">Part</label>
          <select
            id="use-part"
            className="nwi-select"
            required
            value={partId}
            onChange={(e) => setPartId(e.target.value)}
          >
            <option value="">Select a part…</option>
            {parts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.part_number} — {option.description} ({LOCATION_LABELS[option.location]},{' '}
                {option.quantity_on_hand} on hand)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="nwi-label" htmlFor="use-quantity">Quantity</label>
          <input
            id="use-quantity"
            className="nwi-input tabular-nums"
            type="number"
            min="0"
            step="any"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          {part ? (
            <p className={`mt-1 text-sm ${short ? 'font-semibold text-red-700' : 'text-slate-500'}`}>
              {short
                ? `Only ${part.quantity_on_hand} on hand.`
                : `${part.quantity_on_hand - requested} will remain · billed at ${formatMoney(
                    part.unit_price * requested,
                  )}`}
            </p>
          ) : null}
        </div>

        <div>
          <label className="nwi-label" htmlFor="use-notes">Notes</label>
          <input
            id="use-notes"
            className="nwi-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="nwi-btn nwi-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="nwi-btn nwi-btn-primary"
            disabled={saving || short || !partId || !jobId}
          >
            {saving ? 'Working…' : 'Use on job'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

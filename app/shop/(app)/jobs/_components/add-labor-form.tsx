'use client'

// Manual labor entry. Parts reach a job through the inventory "use part" flow,
// but labor has no other writer — without this form a job can never be billed
// for the hours worked on it.

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { TechOption } from '@/lib/shop/jobs'

async function readError(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json()
    if (body && typeof body === 'object' && 'error' in body) {
      const message = (body as { error?: unknown }).error
      if (typeof message === 'string') return message
    }
  } catch {
    // Fall through to the generic message.
  }
  return 'Could not add the labor line. Try again.'
}

export default function AddLaborForm({
  jobId,
  techs,
  defaultTechId,
  laborRate,
  canSetRate,
}: {
  jobId: string
  techs: TechOption[]
  defaultTechId: string | null
  /** Shop labor rate, used when the biller does not override it. */
  laborRate: number
  /** Only a role with viewMargins may set a rate other than the shop default. */
  canSetRate: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [hours, setHours] = useState('1')
  const [rate, setRate] = useState(String(laborRate))
  const [techId, setTechId] = useState(defaultTechId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setDescription('')
    setHours('1')
    setRate(String(laborRate))
    setTechId(defaultTechId ?? '')
    setError(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return

    const trimmed = description.trim()
    const quantity = Number(hours)

    if (!trimmed) {
      setError('Describe the work performed.')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Hours must be greater than zero.')
      return
    }

    // Omitting unit_price lets the server bill at the shop labor rate, which is
    // also what a caller without viewMargins gets — their rate input is never
    // rendered, so there is nothing to send.
    const unitPrice = canSetRate ? Number(rate) : NaN

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/shop/jobs/${jobId}/line-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'labor',
          description: trimmed,
          quantity,
          tech_id: techId || null,
          ...(Number.isFinite(unitPrice) && unitPrice >= 0
            ? { unit_price: unitPrice }
            : {}),
        }),
      })
      if (!res.ok) {
        setError(await readError(res))
        return
      }
      reset()
      setOpen(false)
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="nwi-btn nwi-btn-secondary"
        onClick={() => setOpen(true)}
      >
        Add labor
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="nwi-card space-y-3 p-4">
      <div>
        <label className="nwi-label" htmlFor="labor-description">
          Work performed
        </label>
        <input
          id="labor-description"
          className="nwi-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Replace front brake pads and rotors"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="w-28">
          <label className="nwi-label" htmlFor="labor-hours">
            Hours
          </label>
          <input
            id="labor-hours"
            className="nwi-input"
            type="number"
            step="any"
            min="0"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </div>

        {canSetRate && (
          <div className="w-32">
            <label className="nwi-label" htmlFor="labor-rate">
              Rate / hr
            </label>
            <input
              id="labor-rate"
              className="nwi-input"
              type="number"
              step="any"
              min="0"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </div>
        )}

        <div className="min-w-44 flex-1">
          <label className="nwi-label" htmlFor="labor-tech">
            Tech
          </label>
          <select
            id="labor-tech"
            className="nwi-select"
            value={techId}
            onChange={(e) => setTechId(e.target.value)}
          >
            <option value="">Unassigned</option>
            {techs.map((tech) => (
              <option key={tech.id} value={tech.id}>
                {tech.first_name} {tech.last_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm font-semibold text-red-700">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className="nwi-btn nwi-btn-primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add labor line'}
        </button>
        <button
          type="button"
          className="nwi-btn nwi-btn-secondary"
          onClick={() => {
            reset()
            setOpen(false)
          }}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

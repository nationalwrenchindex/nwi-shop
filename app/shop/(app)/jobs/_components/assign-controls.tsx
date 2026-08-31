'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { TechOption } from '@/lib/shop/jobs'
import type { ShopBay } from '@/lib/types'

/**
 * Bay + tech assignment. Only bays that are free (plus the one this job is
 * already in) are offered. The server re-checks all of this - see
 * PATCH /api/shop/jobs/[id].
 */
export default function AssignControls({
  jobId,
  bays,
  techs,
  currentBayId,
  currentTechId,
  compact = false,
}: {
  jobId: string
  bays: ShopBay[]
  techs: TechOption[]
  currentBayId: string | null
  currentTechId: string | null
  compact?: boolean
}) {
  const router = useRouter()
  const [bayId, setBayId] = useState(currentBayId ?? '')
  const [techId, setTechId] = useState(currentTechId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)

  const selectable = bays.filter((bay) => bay.status === 'available' || bay.id === currentBayId)
  const dirty = bayId !== (currentBayId ?? '') || techId !== (currentTechId ?? '')

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/shop/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bay_id: bayId || null,
          assigned_tech_id: techId || null,
        }),
      })
      const payload: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        const message =
          payload && typeof payload === 'object' && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : 'Could not save the assignment.'
        setError(message)
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setError('Network error - the assignment was not saved.')
    } finally {
      setSaving(false)
    }
  }

  const busy = saving || pending

  return (
    <div className={compact ? 'flex flex-wrap items-end gap-2' : 'space-y-3'}>
      <div className={compact ? 'min-w-32 flex-1' : ''}>
        {!compact && <label className="nwi-label" htmlFor={`bay-${jobId}`}>Bay</label>}
        <select
          id={`bay-${jobId}`}
          aria-label="Bay"
          className="nwi-select"
          value={bayId}
          disabled={busy}
          onChange={(e) => setBayId(e.target.value)}
        >
          <option value="">No bay</option>
          {selectable.map((bay) => (
            <option key={bay.id} value={bay.id}>
              {bay.label}
              {bay.id === currentBayId ? ' (current)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className={compact ? 'min-w-36 flex-1' : ''}>
        {!compact && <label className="nwi-label" htmlFor={`tech-${jobId}`}>Tech</label>}
        <select
          id={`tech-${jobId}`}
          aria-label="Assigned tech"
          className="nwi-select"
          value={techId}
          disabled={busy}
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

      <button
        type="button"
        className="nwi-btn nwi-btn-primary"
        disabled={busy || !dirty}
        onClick={save}
      >
        {busy ? 'Saving...' : 'Assign'}
      </button>

      {error && (
        <p className="w-full text-sm font-semibold text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

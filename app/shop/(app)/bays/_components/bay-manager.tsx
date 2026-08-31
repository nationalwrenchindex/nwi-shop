'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { BayType, ShopBay } from '@/lib/types'

const BAY_TYPES: { value: BayType; label: string }[] = [
  { value: 'lift', label: 'Lift' },
  { value: 'flat', label: 'Flat' },
  { value: 'alignment', label: 'Alignment' },
  { value: 'other', label: 'Other' },
]

const TYPE_LABELS: Record<BayType, string> = {
  lift: 'Lift',
  flat: 'Flat',
  alignment: 'Alignment',
  other: 'Other',
}

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
  return 'Something went wrong. Try again.'
}

export default function BayManager({
  initialBays,
  limit,
  tierLabel,
}: {
  initialBays: ShopBay[]
  limit: number | null
  tierLabel: string
}) {
  const router = useRouter()
  const [bays, setBays] = useState(initialBays)
  const [label, setLabel] = useState('')
  const [type, setType] = useState<BayType>('lift')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const atLimit = limit !== null && bays.length >= limit

  async function addBay(event: FormEvent) {
    event.preventDefault()
    if (busy) return

    const trimmed = label.trim()
    if (!trimmed) {
      setError('Give the bay a label, for example "Bay 1 Lift".')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/shop/bays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: trimmed, type, sort_order: bays.length }),
      })
      if (!res.ok) {
        setError(await readError(res))
        return
      }
      const body: { bay?: ShopBay } = await res.json()
      if (body.bay) {
        const created = body.bay
        setBays((current) => [...current, created])
      }
      setLabel('')
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  async function removeBay(bay: ShopBay) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/shop/bays/${bay.id}`, { method: 'DELETE' })
      if (!res.ok) {
        setError(await readError(res))
        return
      }
      setBays((current) => current.filter((b) => b.id !== bay.id))
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleService(bay: ShopBay) {
    if (busy) return
    // Only the two states a human sets directly. `occupied` is a side effect of
    // assigning a job, and the API refuses to set it through this route.
    const next: ShopBay['status'] =
      bay.status === 'out_of_service' ? 'available' : 'out_of_service'

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/shop/bays/${bay.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        setError(await readError(res))
        return
      }
      setBays((current) =>
        current.map((b) => (b.id === bay.id ? { ...b, status: next } : b)),
      )
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={addBay} className="nwi-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label className="nwi-label" htmlFor="bay-label">
              Bay label
            </label>
            <input
              id="bay-label"
              className="nwi-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Bay 1 Lift"
              disabled={atLimit}
            />
          </div>

          <div className="w-44">
            <label className="nwi-label" htmlFor="bay-type">
              Type
            </label>
            <select
              id="bay-type"
              className="nwi-select"
              value={type}
              onChange={(e) => setType(e.target.value as BayType)}
              disabled={atLimit}
            >
              {BAY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="nwi-btn nwi-btn-primary"
            disabled={busy || atLimit}
          >
            Add bay
          </button>
        </div>

        {atLimit && (
          <p className="mt-3 text-sm text-amber-700">
            {tierLabel} includes {limit} {limit === 1 ? 'bay' : 'bays'}. Upgrade your
            plan to add another.
          </p>
        )}
        {error && <p className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      </form>

      <section className="nwi-card overflow-hidden">
        <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-600">
          {bays.length} {bays.length === 1 ? 'bay' : 'bays'}
          {limit !== null && ` of ${limit}`}
        </h2>

        {bays.length === 0 ? (
          <p className="px-4 py-6 text-slate-500">
            No bays yet. Add the first one above and it will appear on the job board.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {bays.map((bay) => (
              <li key={bay.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex-1 font-semibold text-slate-900">{bay.label}</span>
                <span className="text-sm text-slate-500">{TYPE_LABELS[bay.type]}</span>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                    bay.status === 'available'
                      ? 'bg-emerald-100 text-emerald-800'
                      : bay.status === 'occupied'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-red-100 text-red-800'
                  }`}
                >
                  {bay.status.replace(/_/g, ' ')}
                </span>

                {/* An occupied bay is locked: releasing it belongs to the job's
                    status flow, not to bay setup. */}
                <button
                  type="button"
                  className="nwi-btn nwi-btn-secondary"
                  onClick={() => toggleService(bay)}
                  disabled={busy || bay.status === 'occupied'}
                >
                  {bay.status === 'out_of_service' ? 'Back in service' : 'Out of service'}
                </button>
                <button
                  type="button"
                  className="nwi-btn nwi-btn-danger"
                  onClick={() => removeBay(bay)}
                  disabled={busy || bay.status === 'occupied'}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

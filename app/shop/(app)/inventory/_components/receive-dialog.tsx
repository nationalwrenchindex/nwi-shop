'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  DEFAULT_MARKUP,
  LOCATION_LABELS,
  formatMoney,
  sellPriceFromCost,
  type PartView,
} from '@/lib/shop/inventory'
import Modal from './modal'

interface ReceiveDialogProps {
  part:        PartView
  viewMargins: boolean
  onClose:     () => void
}

/** Books stock in against a part. An updated cost re-prices the part at the
 *  house markup; the cost fields exist only for viewMargins callers. */
export default function ReceiveDialog({ part, viewMargins, onClose }: ReceiveDialogProps) {
  const router = useRouter()

  const [quantity, setQuantity] = useState('1')
  const [updateCost, setUpdateCost] = useState(false)
  const [cost, setCost] = useState(part.unit_cost !== undefined ? String(part.unit_cost) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const costNumber = Number(cost)
  const newPrice = sellPriceFromCost(Number.isFinite(costNumber) ? costNumber : 0)
  const received = Number(quantity) || 0

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const payload: Record<string, unknown> = { quantity: received }
    if (viewMargins && updateCost) payload.unit_cost = Number(cost) || 0

    try {
      const response = await fetch(`/api/shop/inventory/${part.id}/receive`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const result: { error?: string; warning?: string } = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(result.error ?? 'Could not receive the stock.')
        return
      }

      onClose()
      router.refresh()
    } catch {
      setError('Network error — nothing was received.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`Receive ${part.part_number}`}
      subtitle={`${part.description} · ${LOCATION_LABELS[part.location]} · ${part.quantity_on_hand} on hand`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="nwi-label" htmlFor="receive-quantity">Quantity received</label>
          <input
            id="receive-quantity"
            className="nwi-input tabular-nums"
            type="number"
            min="0"
            step="any"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <p className="mt-1 text-sm text-slate-500">
            New on-hand: <span className="font-semibold text-slate-900">
              {part.quantity_on_hand + (received > 0 ? received : 0)}
            </span>
          </p>
        </div>

        {viewMargins ? (
          <div className="rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={updateCost}
                onChange={(e) => setUpdateCost(e.target.checked)}
              />
              Cost changed on this receipt
            </label>

            {updateCost ? (
              <div className="mt-3">
                <label className="nwi-label" htmlFor="receive-cost">New unit cost</label>
                <input
                  id="receive-cost"
                  className="nwi-input tabular-nums"
                  type="number"
                  min="0"
                  step="0.01"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                />
                <p className="mt-1 text-sm text-slate-600">
                  Sell price:{' '}
                  <span className="font-semibold text-slate-900">{formatMoney(newPrice)}</span>
                  {` — ${Math.round(DEFAULT_MARKUP * 100)}% markup, applied to the part.`}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="nwi-btn nwi-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="nwi-btn nwi-btn-primary" disabled={saving}>
            {saving ? 'Receiving…' : 'Receive stock'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

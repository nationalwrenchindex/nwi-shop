'use client'

// Stocks a part found in the shared cross-reference catalog straight into the
// shop's own inventory. It POSTs to the existing /api/shop/inventory route and
// owns nothing else — the route re-checks manageInventory server-side, so this
// control being rendered is a convenience, never the authorisation.
//
// `canSeeCost` mirrors ctx.permissions.viewMargins. When false the cost field is
// not rendered and unit_cost is not sent, so a foreman never puts a number in a
// field they are not allowed to read back.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  partNumber:   string
  description:  string
  manufacturer: string | null
  canSeeCost:   boolean
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }
  | { kind: 'saved' }

export default function AddToInventory({
  partNumber,
  description,
  manufacturer,
  canSeeCost,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [location, setLocation] = useState('shop')
  const [quantity, setQuantity] = useState('1')
  const [reorderPoint, setReorderPoint] = useState('1')
  const [unitCost, setUnitCost] = useState('')

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus({ kind: 'saving' })

    const body: Record<string, string | number> = {
      location,
      part_number:      partNumber,
      description,
      quantity_on_hand: Number(quantity) || 0,
      reorder_point:    Number(reorderPoint) || 0,
    }
    if (manufacturer) body.manufacturer = manufacturer
    // Only a caller with viewMargins may set a cost. Sending it otherwise would
    // be discarded by the route anyway; not sending it keeps the intent honest.
    if (canSeeCost && unitCost.trim()) body.unit_cost = Number(unitCost) || 0

    try {
      const response = await fetch('/api/shop/inventory', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const payload: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        const message =
          payload &&
          typeof payload === 'object' &&
          'error' in payload &&
          typeof (payload as { error: unknown }).error === 'string'
            ? (payload as { error: string }).error
            : 'Could not add the part.'
        setStatus({ kind: 'error', message })
        return
      }

      setStatus({ kind: 'saved' })
      setOpen(false)
      // The inventory list lives on another page; refresh so any cached shell
      // for this session picks up the new part.
      router.refresh()
    } catch {
      setStatus({ kind: 'error', message: 'Network error — the part was not added.' })
    }
  }

  if (status.kind === 'saved' && !open) {
    return (
      <p className="text-sm font-semibold text-emerald-700">
        Added to inventory
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setStatus({ kind: 'idle' })
        }}
        className="nwi-btn nwi-btn-secondary !min-h-10 !px-3 !text-sm"
      >
        Add to inventory
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="w-56 space-y-3">
      <div>
        <label className="nwi-label" htmlFor={`loc-${partNumber}`}>
          Location
        </label>
        <select
          id={`loc-${partNumber}`}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="nwi-select"
        >
          <option value="shop">Shop</option>
          <option value="vehicle">Service vehicle</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="nwi-label" htmlFor={`qty-${partNumber}`}>
            Qty
          </label>
          <input
            id={`qty-${partNumber}`}
            type="number"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="nwi-input"
          />
        </div>
        <div>
          <label className="nwi-label" htmlFor={`rop-${partNumber}`}>
            Reorder at
          </label>
          <input
            id={`rop-${partNumber}`}
            type="number"
            min="0"
            step="any"
            value={reorderPoint}
            onChange={(e) => setReorderPoint(e.target.value)}
            className="nwi-input"
          />
        </div>
      </div>

      {canSeeCost ? (
        <div>
          <label className="nwi-label" htmlFor={`cost-${partNumber}`}>
            Unit cost
          </label>
          <input
            id={`cost-${partNumber}`}
            type="number"
            min="0"
            step="0.01"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            placeholder="0.00"
            className="nwi-input"
          />
        </div>
      ) : null}

      {status.kind === 'error' ? (
        <p className="text-sm font-semibold text-red-700">{status.message}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={status.kind === 'saving'}
          className="nwi-btn nwi-btn-primary !min-h-10 !px-3 !text-sm"
        >
          {status.kind === 'saving' ? 'Adding…' : 'Add'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="nwi-btn nwi-btn-secondary !min-h-10 !px-3 !text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

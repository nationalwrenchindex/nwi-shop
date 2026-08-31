'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  DEFAULT_MARKUP,
  INVENTORY_LOCATIONS,
  LOCATION_LABELS,
  formatMoney,
  sellPriceFromCost,
} from '@/lib/shop/inventory'
import type { InventoryLoc } from '@/lib/types'
import Modal from './modal'

interface AddPartDialogProps {
  /** The cost input is rendered only for callers allowed to see margins. */
  viewMargins: boolean
}

const MARKUP_LABEL = `${Math.round(DEFAULT_MARKUP * 100)}% markup`

export default function AddPartDialog({ viewMargins }: AddPartDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const [partNumber, setPartNumber] = useState('')
  const [description, setDescription] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [vendor, setVendor] = useState('')
  const [location, setLocation] = useState<InventoryLoc>('shop')
  const [quantity, setQuantity] = useState('0')
  const [reorderPoint, setReorderPoint] = useState('0')
  const [cost, setCost] = useState('')
  /** null means "follow the markup"; a string is an explicit override. */
  const [priceOverride, setPriceOverride] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const costNumber = Number(cost)
  const suggested = sellPriceFromCost(Number.isFinite(costNumber) ? costNumber : 0)

  // Live markup, derived rather than synced: the price field simply *is* the
  // marked-up cost until the user types over it.
  const markupPrice = suggested > 0 ? suggested.toFixed(2) : ''
  const price = priceOverride ?? markupPrice
  const priceEdited = priceOverride !== null

  function reset() {
    setPartNumber('')
    setDescription('')
    setManufacturer('')
    setVendor('')
    setLocation('shop')
    setQuantity('0')
    setReorderPoint('0')
    setCost('')
    setPriceOverride(null)
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const payload: Record<string, unknown> = {
      part_number:      partNumber,
      description,
      manufacturer:     manufacturer || null,
      vendor:           vendor || null,
      location,
      quantity_on_hand: Number(quantity) || 0,
      reorder_point:    Number(reorderPoint) || 0,
    }
    // A foreman posts no cost at all; the server keeps the part at cost 0.
    if (viewMargins) {
      payload.unit_cost = Number(cost) || 0
      if (price !== '') payload.unit_price = Number(price) || 0
    }

    try {
      const response = await fetch('/api/shop/inventory', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const result: { error?: string } = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(result.error ?? 'Could not save the part.')
        return
      }

      reset()
      setOpen(false)
      router.refresh()
    } catch {
      setError('Network error — the part was not saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button type="button" className="nwi-btn nwi-btn-primary" onClick={() => setOpen(true)}>
        Add part
      </button>

      {open ? (
        <Modal
          title="Add a part"
          subtitle="A part is stocked at one location. The same part number can exist in the shop and on a vehicle."
          onClose={() => setOpen(false)}
        >
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="nwi-label" htmlFor="add-part-number">Part number</label>
                <input
                  id="add-part-number"
                  className="nwi-input font-mono"
                  required
                  value={partNumber}
                  onChange={(e) => setPartNumber(e.target.value)}
                />
              </div>
              <div>
                <label className="nwi-label" htmlFor="add-location">Location</label>
                <select
                  id="add-location"
                  className="nwi-select"
                  value={location}
                  onChange={(e) => setLocation(e.target.value as InventoryLoc)}
                >
                  {INVENTORY_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>{LOCATION_LABELS[loc]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="nwi-label" htmlFor="add-description">Description</label>
              <input
                id="add-description"
                className="nwi-input"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="nwi-label" htmlFor="add-manufacturer">Manufacturer</label>
                <input
                  id="add-manufacturer"
                  className="nwi-input"
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                />
              </div>
              <div>
                <label className="nwi-label" htmlFor="add-vendor">Vendor</label>
                <input
                  id="add-vendor"
                  className="nwi-input"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="nwi-label" htmlFor="add-quantity">Quantity on hand</label>
                <input
                  id="add-quantity"
                  className="nwi-input tabular-nums"
                  type="number"
                  min="0"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              <div>
                <label className="nwi-label" htmlFor="add-reorder">Reorder point</label>
                <input
                  id="add-reorder"
                  className="nwi-input tabular-nums"
                  type="number"
                  min="0"
                  step="any"
                  value={reorderPoint}
                  onChange={(e) => setReorderPoint(e.target.value)}
                />
              </div>
            </div>

            {viewMargins ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="nwi-label" htmlFor="add-cost">Unit cost</label>
                  <input
                    id="add-cost"
                    className="nwi-input tabular-nums"
                    type="number"
                    min="0"
                    step="0.01"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                  />
                </div>
                <div>
                  <label className="nwi-label" htmlFor="add-price">Sell price</label>
                  <input
                    id="add-price"
                    className="nwi-input tabular-nums"
                    type="number"
                    min="0"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPriceOverride(e.target.value)}
                  />
                </div>
                <p className="text-sm text-slate-600 sm:col-span-2">
                  Sell price:{' '}
                  <span className="font-semibold text-slate-900">{formatMoney(suggested)}</span>
                  {` — ${MARKUP_LABEL}`}
                  {priceEdited ? (
                    <button
                      type="button"
                      className="ml-2 text-sm font-semibold text-slate-900 underline"
                      onClick={() => setPriceOverride(null)}
                    >
                      Reset to markup
                    </button>
                  ) : null}
                </p>
              </div>
            ) : (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Part cost is set by a shop manager. This part is created without a cost.
              </p>
            )}

            {error ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="nwi-btn nwi-btn-secondary"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="nwi-btn nwi-btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Add part'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  )
}

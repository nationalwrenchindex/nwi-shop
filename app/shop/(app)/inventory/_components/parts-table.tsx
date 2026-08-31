'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  LOCATION_LABELS,
  formatMoney,
  formatPct,
  isLowStock,
  marginPct,
  type PartView,
} from '@/lib/shop/inventory'
import ReceiveDialog from './receive-dialog'
import UsePartDialog from './use-part-dialog'

interface PartsTableProps {
  parts:       PartView[]
  /** Every in-stock part, so the "use on job" dropdown is not limited to
   *  whatever the current search happens to show. */
  selectableParts: PartView[]
  canManage:   boolean
  /** When false the cost + margin columns do not exist — the server never sent
   *  a `unit_cost` for these rows in the first place. */
  viewMargins: boolean
  emptyHint:   string
}

export default function PartsTable({
  parts,
  selectableParts,
  canManage,
  viewMargins,
  emptyHint,
}: PartsTableProps) {
  const router = useRouter()
  const [receiving, setReceiving] = useState<PartView | null>(null)
  const [using, setUsing] = useState<PartView | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function remove(part: PartView) {
    if (!window.confirm(`Delete ${part.part_number}? Its transaction history stays.`)) return
    setBusyId(part.id)
    setError(null)
    try {
      const response = await fetch(`/api/shop/inventory/${part.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const result: { error?: string } = await response.json().catch(() => ({}))
        setError(result.error ?? 'Could not delete the part.')
        return
      }
      router.refresh()
    } catch {
      setError('Network error — the part was not deleted.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="nwi-card overflow-hidden">
      {error ? (
        <p className="border-b border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <Th>Part #</Th>
              <Th>Description</Th>
              <Th>Manufacturer</Th>
              <Th>Location</Th>
              <Th align="right">On hand</Th>
              <Th align="right">Reorder</Th>
              {viewMargins ? <Th align="right">Unit cost</Th> : null}
              <Th align="right">Sell price</Th>
              {viewMargins ? <Th align="right">Margin</Th> : null}
              {canManage ? <Th align="right">Actions</Th> : null}
            </tr>
          </thead>
          <tbody>
            {parts.length === 0 ? (
              <tr>
                <td
                  colSpan={canManage ? 10 : 9}
                  className="px-3 py-10 text-center text-sm text-slate-500"
                >
                  {emptyHint}
                </td>
              </tr>
            ) : (
              parts.map((part) => {
                const low = isLowStock(part)
                return (
                  <tr
                    key={part.id}
                    className={`border-b border-slate-100 last:border-0 ${
                      low ? 'bg-red-50/60' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="px-3 py-2 font-mono font-semibold text-slate-900">
                      {part.part_number}
                    </td>
                    <td className="px-3 py-2 text-slate-800">{part.description}</td>
                    <td className="px-3 py-2 text-slate-600">{part.manufacturer ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{LOCATION_LABELS[part.location]}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        low ? 'font-bold text-red-700' : 'text-slate-900'
                      }`}
                    >
                      {part.quantity_on_hand}
                      {low ? <span className="ml-1 text-xs font-semibold uppercase">low</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {part.reorder_point}
                    </td>
                    {viewMargins ? (
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatMoney(part.unit_cost ?? 0)}
                      </td>
                    ) : null}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {formatMoney(part.unit_price)}
                    </td>
                    {viewMargins ? (
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatPct(marginPct(part.unit_cost ?? 0, part.unit_price))}
                      </td>
                    ) : null}
                    {canManage ? (
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <RowButton onClick={() => setReceiving(part)}>Receive</RowButton>
                          <RowButton
                            onClick={() => setUsing(part)}
                            disabled={part.quantity_on_hand <= 0}
                          >
                            Use
                          </RowButton>
                          <RowButton
                            onClick={() => remove(part)}
                            disabled={busyId === part.id}
                            tone="danger"
                          >
                            Delete
                          </RowButton>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {receiving ? (
        <ReceiveDialog
          part={receiving}
          viewMargins={viewMargins}
          onClose={() => setReceiving(null)}
        />
      ) : null}

      {using ? (
        <UsePartDialog
          parts={selectableParts}
          initialPartId={using.id}
          onClose={() => setUsing(null)}
        />
      ) : null}
    </div>
  )
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function RowButton({
  children,
  onClick,
  disabled,
  tone = 'default',
}: {
  children:  React.ReactNode
  onClick:   () => void
  disabled?: boolean
  tone?:     'default' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2.5 py-1 text-xs font-semibold disabled:opacity-40 ${
        tone === 'danger'
          ? 'border-red-200 bg-white text-red-700 hover:bg-red-50'
          : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  )
}

'use client'

import { useRouter } from 'next/navigation'
import { INVENTORY_TX_TYPES, TX_TYPE_LABELS } from '@/lib/shop/inventory'
import { withParams, type QueryState } from './query'

interface TransactionFiltersProps {
  type:   string
  from:   string
  to:     string
  params: QueryState
}

/** Type + date-range filters for the movement history. Query-string driven so
 *  the filtering itself happens on the server. */
export default function TransactionFilters({ type, from, to, params }: TransactionFiltersProps) {
  const router = useRouter()

  function set(patch: Record<string, string | null>) {
    router.replace(withParams(params, patch))
  }

  const dirty = type !== '' || from !== '' || to !== ''

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="nwi-label" htmlFor="tx-type">Type</label>
        <select
          id="tx-type"
          className="nwi-select w-44"
          value={type}
          onChange={(e) => set({ tx: e.target.value || null })}
        >
          <option value="">All types</option>
          {INVENTORY_TX_TYPES.map((value) => (
            <option key={value} value={value}>{TX_TYPE_LABELS[value]}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="nwi-label" htmlFor="tx-from">From</label>
        <input
          id="tx-from"
          type="date"
          className="nwi-input w-44"
          value={from}
          onChange={(e) => set({ from: e.target.value || null })}
        />
      </div>

      <div>
        <label className="nwi-label" htmlFor="tx-to">To</label>
        <input
          id="tx-to"
          type="date"
          className="nwi-input w-44"
          value={to}
          onChange={(e) => set({ to: e.target.value || null })}
        />
      </div>

      {dirty ? (
        <button
          type="button"
          className="nwi-btn nwi-btn-secondary"
          onClick={() => set({ tx: null, from: null, to: null })}
        >
          Clear
        </button>
      ) : null}
    </div>
  )
}

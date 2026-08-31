'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { INVENTORY_LOCATIONS, LOCATION_LABELS } from '@/lib/shop/inventory'
import { withParams, type QueryState } from './query'

interface ToolbarProps {
  query:    string
  location: string
  params:   QueryState
  counts:   { all: number; shop: number; vehicle: number }
}

/** One search box across part number / description / manufacturer, plus the
 *  location tabs. Both are query-string driven so the filtering is server-side. */
export default function InventoryToolbar({ query, location, params, counts }: ToolbarProps) {
  const router = useRouter()
  const [value, setValue] = useState(query)
  const [syncedQuery, setSyncedQuery] = useState(query)

  // Keep the box in step when the URL changes underneath us (back button). This
  // is the "adjust state during render" pattern rather than an effect, so it
  // costs one extra render instead of a full commit-then-re-render cycle.
  if (syncedQuery !== query) {
    setSyncedQuery(query)
    setValue(query)
  }

  // Debounced push so typing feels instant without a request per keystroke.
  useEffect(() => {
    if (value === query) return
    const timer = setTimeout(() => {
      router.replace(withParams(params, { q: value.trim() || null }))
    }, 300)
    return () => clearTimeout(timer)
  }, [value, query, params, router])

  const tabs: { key: string; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: counts.all },
    ...INVENTORY_LOCATIONS.map((loc) => ({
      key:   loc,
      label: LOCATION_LABELS[loc],
      count: loc === 'shop' ? counts.shop : counts.vehicle,
    })),
  ]

  return (
    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {tabs.map((tab) => {
          const active = (location || 'all') === tab.key
          return (
            <Link
              key={tab.key}
              href={withParams(params, { location: tab.key === 'all' ? null : tab.key })}
              className={`rounded-md px-3 py-2 text-sm font-semibold ${
                active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 text-xs ${active ? 'text-slate-300' : 'text-slate-400'}`}>
                {tab.count}
              </span>
            </Link>
          )
        })}
      </div>

      <div className="sm:w-80">
        <label className="sr-only" htmlFor="inventory-search">
          Search parts
        </label>
        <input
          id="inventory-search"
          type="search"
          className="nwi-input"
          placeholder="Search part number, description, manufacturer"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
    </div>
  )
}

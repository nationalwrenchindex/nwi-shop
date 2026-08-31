'use client'

// Page-level range selector. The selected range lives in the URL, not in React
// state, so the page stays a server component, the numbers are always fetched with
// the same query the export uses, and a range is a shareable/bookmarkable link.

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { RANGE_PRESETS, type RangePreset } from '@/lib/shop/quickbooks'

interface Props {
  preset: RangePreset
  year:   number
  from:   string
  to:     string
  /** Years offered in the dropdown, newest first. */
  years:  number[]
}

export default function RangeSelector({ preset, year, from, to, years }: Props) {
  const router = useRouter()
  // Custom dates are held locally until Apply so a half-typed date does not fire a
  // navigation (and a query) on every keystroke.
  const [customFrom, setCustomFrom] = useState(from)
  const [customTo,   setCustomTo]   = useState(to)

  function go(next: { preset: RangePreset; year: number; from?: string; to?: string }) {
    const params = new URLSearchParams()
    params.set('preset', next.preset)
    params.set('year', String(next.year))
    if (next.preset === 'custom') {
      params.set('from', next.from ?? from)
      params.set('to',   next.to   ?? to)
    }
    router.push(`/shop/financials?${params.toString()}`)
  }

  return (
    <div className="nwi-card p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <span className="nwi-label">Period</span>
          <div className="flex flex-wrap gap-2">
            {RANGE_PRESETS.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => go({ preset: p.key, year, from: customFrom, to: customTo })}
                aria-pressed={preset === p.key}
                className={`min-h-11 rounded-lg border px-4 text-sm font-semibold ${
                  preset === p.key
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="w-32">
          <label className="nwi-label" htmlFor="financials-year">Year</label>
          <select
            id="financials-year"
            className="nwi-select"
            value={year}
            onChange={e => go({ preset, year: Number(e.target.value), from: customFrom, to: customTo })}
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {preset === 'custom' && (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-200 pt-4">
          <div>
            <label className="nwi-label" htmlFor="financials-from">From</label>
            <input
              id="financials-from"
              type="date"
              className="nwi-input"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="nwi-label" htmlFor="financials-to">To</label>
            <input
              id="financials-to"
              type="date"
              className="nwi-input"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="nwi-btn nwi-btn-primary"
            onClick={() => go({ preset: 'custom', year, from: customFrom, to: customTo })}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  )
}

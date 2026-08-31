'use client'

// Accountant hand-off. Owns its OWN date range, independent of the page period
// above it, because the range you reconcile a quarter with is rarely the range you
// were just looking at.
//
// The files themselves are built on the server (/api/shop/financials/export) from
// the same query that feeds this preview, so the "N invoices - $X" line below is a
// promise about the file you are about to download, not a separate calculation.
//
// There is deliberately no useEffect here: the first preview is seeded from the
// server render (the page's own period is this block's starting range), and every
// later refresh is triggered by the click or change that altered the range.

import { useRef, useState } from 'react'
import {
  RANGE_PRESETS,
  rangeFor,
  type RangePreset,
} from '@/lib/shop/quickbooks'
import { formatMoney } from './format'

interface SummaryResponse {
  from:          string
  to:            string
  invoiceCount:  number
  totalInvoiced: number
  error?:        string
}

interface Preview {
  count: number
  total: number
}

interface Props {
  initialPreset: RangePreset
  initialYear:   number
  initialFrom:   string
  initialTo:     string
  /** The server-rendered numbers for the initial range - avoids a mount fetch. */
  initialCount:  number
  initialTotal:  number
  years:         number[]
}

export default function QuickbooksExport({
  initialPreset, initialYear, initialFrom, initialTo, initialCount, initialTotal, years,
}: Props) {
  const [preset,  setPreset]  = useState<RangePreset>(initialPreset)
  const [year,    setYear]    = useState<number>(initialYear)
  const [from,    setFrom]    = useState(initialFrom)
  const [to,      setTo]      = useState(initialTo)
  const [preview, setPreview] = useState<Preview | null>({ count: initialCount, total: initialTotal })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // Ranges change fast when someone clicks through the quarters. Only the newest
  // request is allowed to write state, so a slow earlier response cannot land on top
  // of a newer one and show a count for a range nobody is looking at.
  const requestId = useRef(0)

  async function refresh(nextFrom: string, nextTo: string) {
    const id = ++requestId.current

    if (!nextFrom || !nextTo) {
      setPreview(null)
      setError(null)
      return
    }
    if (nextFrom > nextTo) {
      setPreview(null)
      setError('Start date must not be after end date.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/shop/financials/summary?from=${nextFrom}&to=${nextTo}`)
      const body = await res.json() as SummaryResponse
      if (!res.ok) throw new Error(body?.error ?? 'Could not load invoices for this range.')
      if (id !== requestId.current) return
      setPreview({ count: body.invoiceCount, total: body.totalInvoiced })
    } catch (err) {
      if (id !== requestId.current) return
      setPreview(null)
      setError(err instanceof Error ? err.message : 'Could not load invoices for this range.')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  function applyRange(nextFrom: string, nextTo: string) {
    setFrom(nextFrom)
    setTo(nextTo)
    void refresh(nextFrom, nextTo)
  }

  function applyPreset(key: RangePreset, forYear = year) {
    setPreset(key)
    setYear(forYear)
    // Custom keeps whatever is already in the inputs; it only stops the preset
    // buttons from overwriting a hand-picked range.
    if (key === 'custom') return
    const next = rangeFor(key, forYear)
    applyRange(next.from, next.to)
  }

  const count    = preview?.count ?? 0
  const disabled = loading || !!error || count === 0

  function download(format: 'iif' | 'csv') {
    if (disabled) return
    // A temporary anchor rather than window.location: this is a file download, not a
    // navigation, and the download attribute keeps the browser on the page even if a
    // future proxy strips the Content-Disposition header.
    const link = document.createElement('a')
    link.href     = `/api/shop/financials/export?format=${format}&from=${from}&to=${to}`
    link.download = `nwi-shop-invoices-${from}-to-${to}.${format}`
    link.click()
  }

  return (
    <section className="nwi-card p-5 sm:p-6">
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-lg font-semibold text-slate-900">QuickBooks export</h2>
        <p className="mt-1 text-sm text-slate-600">
          Hand your invoices to your accountant. Voided invoices are excluded from both
          files and from the counts below.
        </p>
      </div>

      {/* Export range - independent of the period selector at the top of the page. */}
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div>
          <span className="nwi-label">Export period</span>
          <div className="flex flex-wrap gap-2">
            {RANGE_PRESETS.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
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
          <label className="nwi-label" htmlFor="qb-year">Year</label>
          <select
            id="qb-year"
            className="nwi-select"
            value={year}
            onChange={e => applyPreset(preset === 'custom' ? 'ytd' : preset, Number(e.target.value))}
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Date inputs stay visible for every preset so the resolved range is auditable. */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="nwi-label" htmlFor="qb-from">From</label>
          <input
            id="qb-from"
            type="date"
            className="nwi-input"
            value={from}
            onChange={e => { setPreset('custom'); applyRange(e.target.value, to) }}
          />
        </div>
        <div>
          <label className="nwi-label" htmlFor="qb-to">To</label>
          <input
            id="qb-to"
            type="date"
            className="nwi-input"
            value={to}
            onChange={e => { setPreset('custom'); applyRange(from, e.target.value) }}
          />
        </div>
      </div>

      {/* Sanity check before download. */}
      <div className="mt-4 rounded-lg bg-slate-100 px-4 py-3" aria-live="polite">
        {loading ? (
          <p className="text-sm text-slate-500">Checking this range…</p>
        ) : error ? (
          <p className="text-sm font-medium text-rose-700">{error}</p>
        ) : count === 0 ? (
          <p className="text-sm text-slate-500">
            No invoices in this range — pick a wider range to export.
          </p>
        ) : (
          <p className="text-sm text-slate-900">
            <span className="font-mono font-semibold tabular-nums">{count}</span>
            {' '}invoice{count === 1 ? '' : 's'}
            {' · '}
            <span className="font-mono font-semibold tabular-nums">
              {formatMoney(preview?.total ?? 0)}
            </span>
            <span className="ml-2 text-xs text-slate-500">{from} → {to}</span>
          </p>
        )}
      </div>

      {/* Downloads, each with the import path spelled out - people forget them. */}
      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <button
            type="button"
            className="nwi-btn nwi-btn-primary w-full"
            disabled={disabled}
            onClick={() => download('iif')}
          >
            Download .IIF (Desktop)
          </button>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            QuickBooks Desktop: <span className="font-medium text-slate-700">File → Utilities →
            Import → IIF Files</span>, then choose the downloaded file.
          </p>
        </div>
        <div>
          <button
            type="button"
            className="nwi-btn nwi-btn-secondary w-full"
            disabled={disabled}
            onClick={() => download('csv')}
          >
            Download .CSV (Online)
          </button>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            QuickBooks Online: <span className="font-medium text-slate-700">Settings → Import
            Data → Invoices</span>, then upload the downloaded file and map the columns.
          </p>
        </div>
      </div>
    </section>
  )
}

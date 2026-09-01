'use client'

// The half of Trailer ABS that has nothing to do with AI.
//
// The page hands down the whole catalog (~100 rows) on the server render and this filters
// it locally, the same way the source panel did. That is a deliberate choice for a tablet
// under a trailer on shop wifi: typing a search must not wait on a round trip, and once
// the page is open the rows stay usable even if the connection drops.
//
// It works in full with no GEMINI_API_KEY. Nothing on this component calls a model.

import { useMemo, useState } from 'react'
import {
  CATEGORY_LABELS,
  CATEGORY_SYSTEMS,
  REFERENCE_CATEGORIES,
  matchesTrailerNeedle,
  type ReferenceCategory,
  type ReferenceSource,
  type TrailerReferenceEntry,
} from '@/lib/shop/trailer/reference-categories'

export default function ReferenceBrowser({
  initialEntries,
  initialSource,
  catalogAvailable,
}: {
  initialEntries: TrailerReferenceEntry[]
  initialSource: ReferenceSource
  catalogAvailable: boolean
}) {
  const [entries, setEntries] = useState(initialEntries)
  const [source, setSource] = useState<ReferenceSource>(initialSource)
  const [available, setAvailable] = useState(catalogAvailable)
  const [category, setCategory] = useState<ReferenceCategory | null>(null)
  const [query, setQuery] = useState('')
  const [reloading, setReloading] = useState(false)
  const [reloadError, setReloadError] = useState<string | null>(null)

  const visible = useMemo(() => {
    const systems = category ? CATEGORY_SYSTEMS[category] : null
    const needle = query.trim()
    return entries
      .filter((row) => (systems ? systems.includes(row.system) : true))
      .filter((row) => matchesTrailerNeedle(row, needle))
  }, [entries, category, query])

  // Rows grouped under their stored system, so 'Brake Chambers' and 'Air Brakes' stay
  // visually separate inside the one Air Brakes category.
  const grouped = useMemo(() => {
    const map = new Map<string, TrailerReferenceEntry[]>()
    for (const row of visible) {
      const bucket = map.get(row.system)
      if (bucket) bucket.push(row)
      else map.set(row.system, [row])
    }
    return [...map.entries()]
  }, [visible])

  async function reload() {
    setReloading(true)
    setReloadError(null)
    try {
      const res = await fetch('/api/shop/tools/trailer-abs/reference', { cache: 'no-store' })
      const body: unknown = await res.json()
      if (!res.ok) {
        const message =
          body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : 'Could not reload the reference.'
        setReloadError(message)
        return
      }
      const payload = body as {
        entries: TrailerReferenceEntry[]
        source: ReferenceSource
        available: boolean
      }
      setEntries(payload.entries)
      setSource(payload.source)
      setAvailable(payload.available)
    } catch {
      setReloadError('Could not reach the server. You are still looking at the rows this page loaded with.')
    } finally {
      setReloading(false)
    }
  }

  return (
    <section className="nwi-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Trailer Reference</h2>
          <p className="mt-1 text-sm text-slate-600">
            Air brakes, chambers, slack adjusters, shoes and drums, ABS blink codes, the
            J560 pin-out and fastener torques. No AI — this works whether or not the
            diagnostic below is configured.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={reloading}
          className="nwi-btn nwi-btn-secondary"
        >
          {reloading ? 'Reloading…' : 'Reload'}
        </button>
      </div>

      {!available ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">
          The shared trailer reference catalog is not reachable from this deployment. The
          rows below are the copy bundled with the app — the same content, but not live.
          Check any spec against the manufacturer literature before you act on it.
        </p>
      ) : source === 'bundled' ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">
          Showing the bundled copy of the reference rather than the live catalog.
        </p>
      ) : null}

      {reloadError ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {reloadError}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <CategoryButton
          label="All"
          active={category === null}
          onClick={() => setCategory(null)}
        />
        {REFERENCE_CATEGORIES.map((value) => (
          <CategoryButton
            key={value}
            label={CATEGORY_LABELS[value]}
            active={category === value}
            onClick={() => setCategory(value)}
          />
        ))}
      </div>

      <div className="mt-4">
        <label htmlFor="trailer-ref-search" className="nwi-label">
          Search
        </label>
        <input
          id="trailer-ref-search"
          type="search"
          className="nwi-input"
          placeholder="Chamber stroke, Haldex 1-1, pin 7, wheel bearing torque…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>

      <p className="mt-3 text-sm text-slate-500">
        {visible.length} {visible.length === 1 ? 'entry' : 'entries'}
        {entries.length && visible.length !== entries.length ? ` of ${entries.length}` : ''}
      </p>

      {visible.length === 0 ? (
        <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          {entries.length === 0
            ? 'No reference rows loaded. Press Reload — if that does not help, the shared catalog is not provisioned for this deployment yet.'
            : 'Nothing matches that. Try a shorter search, or clear the category filter.'}
        </p>
      ) : (
        <div className="mt-4 space-y-6">
          {grouped.map(([system, rows]) => (
            <div key={system}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                {system}
              </h3>
              <ul className="mt-2 space-y-3">
                {rows.map((row) => (
                  <ReferenceRow key={`${row.id ?? 'bundled'}:${row.system}:${row.component}`} row={row} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function CategoryButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'nwi-btn nwi-btn-primary'
          : 'nwi-btn nwi-btn-secondary'
      }
    >
      {label}
    </button>
  )
}

function ReferenceRow({ row }: { row: TrailerReferenceEntry }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-base font-semibold text-slate-900">{row.component}</h4>
        {row.value ? (
          <span className="font-mono text-base font-semibold text-slate-900">
            {row.value}
            {row.units ? <span className="ml-1 text-sm text-slate-500">{row.units}</span> : null}
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-sm leading-relaxed text-slate-700">{row.description}</p>

      <p className="mt-2 text-xs uppercase tracking-wide text-slate-400">{row.manufacturer}</p>

      {row.notes ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            Procedure &amp; cautions
          </summary>
          {/* whitespace-pre-line: the notes are written as numbered procedures with real
              line breaks, and collapsing them would run the steps together. */}
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">
            {row.notes}
          </p>
        </details>
      ) : null}
    </li>
  )
}

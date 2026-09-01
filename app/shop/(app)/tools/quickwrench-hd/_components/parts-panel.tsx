'use client'

// HD parts lookup against the shared catalog, plus build-number decode. Database
// reads only — no AI, so this panel works with no model key.
//
// Note the model filter: when a unit model is entered the catalog returns only
// parts explicitly listed for that model. That is narrower than a tech might
// expect and it is meant to be — an empty result is recoverable, the wrong belt
// on a Class 8 unit is not.

import { useState } from 'react'
import { getJson, type HdCrossRefView, type HdPartView } from './types'

interface PartsResponse {
  build: {
    manufacturer:     string
    bm_number:        string
    unit_model:       string | null
    refrigerant_type: string | null
    known_parts:      string | null
  } | null
  parts:     HdPartView[]
  crossRefs: HdCrossRefView[]
  note?:     string
}

const MANUFACTURERS = ['', 'Thermo King', 'Carrier Transicold', 'Delco Remy', 'Generic']

export default function PartsPanel() {
  const [manufacturer, setManufacturer] = useState('')
  const [unitModel, setUnitModel] = useState('')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [bm, setBm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PartsResponse | null>(null)

  async function query(params: URLSearchParams) {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await getJson<PartsResponse>(`/api/shop/tools/quickwrench-hd/parts?${params}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed.')
    } finally {
      setBusy(false)
    }
  }

  function runParts() {
    const params = new URLSearchParams()
    if (manufacturer) params.set('manufacturer', manufacturer)
    if (unitModel.trim()) params.set('unitModel', unitModel.trim())
    if (category.trim()) params.set('category', category.trim())
    if (search.trim()) params.set('search', search.trim())
    if ([...params.keys()].length === 0) {
      setError('Give at least one filter — manufacturer, model, category or a search term.')
      return
    }
    void query(params)
  }

  function runBuild() {
    if (!bm.trim()) {
      setError('Enter a build number.')
      return
    }
    const params = new URLSearchParams({ bm: bm.trim() })
    if (manufacturer === 'Thermo King') params.set('bmManufacturer', 'TK')
    if (manufacturer === 'Carrier Transicold') params.set('bmManufacturer', 'Carrier')
    void query(params)
  }

  const crossByPart = new Map<string, HdCrossRefView[]>()
  for (const ref of result?.crossRefs ?? []) {
    const list = crossByPart.get(ref.part_number) ?? []
    list.push(ref)
    crossByPart.set(ref.part_number, list)
  }

  return (
    <div className="space-y-4">
      <section className="nwi-card p-4 sm:p-5">
        <p className="text-sm leading-relaxed text-slate-600">
          Reads the shared HD parts catalog. No AI — this panel works with no
          model key. Entering a unit model narrows results to parts listed for
          that exact model.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="nwi-label" htmlFor="qwhd-p-mfr">Manufacturer</label>
            <select id="qwhd-p-mfr" className="nwi-select" value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}>
              {MANUFACTURERS.map((m) => (
                <option key={m || 'any'} value={m}>{m || 'Any'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="nwi-label" htmlFor="qwhd-p-model">Unit model</label>
            <input id="qwhd-p-model" className="nwi-input" placeholder="S-600"
              value={unitModel} onChange={(e) => setUnitModel(e.target.value)} />
          </div>
          <div>
            <label className="nwi-label" htmlFor="qwhd-p-cat">Category</label>
            <input id="qwhd-p-cat" className="nwi-input" placeholder="belt, sensor, filter…"
              value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div>
            <label className="nwi-label" htmlFor="qwhd-p-search">Part number or text</label>
            <input id="qwhd-p-search" className="nwi-input"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <button type="button" className="nwi-btn nwi-btn-primary" onClick={runParts} disabled={busy}>
            {busy ? 'Searching…' : 'Search parts'}
          </button>
          <div className="min-w-40">
            <label className="nwi-label" htmlFor="qwhd-p-bm">Build number (BM)</label>
            <input id="qwhd-p-bm" className="nwi-input" value={bm} onChange={(e) => setBm(e.target.value)} />
          </div>
          <button type="button" className="nwi-btn nwi-btn-secondary" onClick={runBuild} disabled={busy}>
            Decode build number
          </button>
        </div>

        {error ? <p className="mt-3 text-sm font-medium text-red-700">{error}</p> : null}
      </section>

      {result?.build ? (
        <section className="nwi-card p-4 sm:p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Build number {result.build.bm_number}
          </h3>
          <p className="mt-2 text-sm text-slate-800">
            {result.build.manufacturer}
            {result.build.unit_model ? ` · ${result.build.unit_model}` : ''}
            {result.build.refrigerant_type ? ` · ${result.build.refrigerant_type}` : ''}
          </p>
          {result.build.known_parts ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{result.build.known_parts}</p>
          ) : null}
        </section>
      ) : null}

      {result && !result.build ? (
        result.parts.length === 0 ? (
          <section className="nwi-card p-4 sm:p-5">
            <p className="text-sm leading-relaxed text-slate-600">
              Nothing in the catalog matched. If you filtered by unit model, try
              without it — a part may be on file without that model listed. Verify
              any part number with your dealer before ordering.
            </p>
          </section>
        ) : (
          <section className="nwi-card divide-y divide-slate-100">
            {result.parts.map((part) => {
              const refs = crossByPart.get(part.part_number) ?? []
              return (
                <div key={part.part_number} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-sm font-semibold text-slate-900">
                      {part.part_number}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-slate-500">
                      {part.manufacturer} · {part.category}
                      {part.subcategory ? ` · ${part.subcategory}` : ''}
                    </span>
                    {part.field_critical ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
                        field critical
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-800">{part.description}</p>
                  {part.superseded_by ? (
                    <p className="mt-1 text-sm font-medium text-slate-700">
                      Superseded by {part.superseded_by} — order the current number.
                    </p>
                  ) : null}
                  {part.unit_models && part.unit_models.length > 0 ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Fits: {part.unit_models.join(', ')}
                    </p>
                  ) : null}
                  {part.notes ? <p className="mt-1 text-xs text-slate-500">{part.notes}</p> : null}
                  {refs.length > 0 ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Cross reference:{' '}
                      {refs.map((r) => `${r.cross_mfr} ${r.cross_part}`).join(', ')}
                    </p>
                  ) : null}
                </div>
              )
            })}
            {result.note ? (
              <div className="p-4 sm:p-5">
                <p className="text-xs leading-relaxed text-slate-500">{result.note}</p>
              </div>
            ) : null}
          </section>
        )
      ) : null}
    </div>
  )
}

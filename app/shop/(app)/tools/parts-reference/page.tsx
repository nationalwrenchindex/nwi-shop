// /shop/tools/parts-reference — available to every shop type at Pro or better.
// requireFeature() is the FIRST statement, so a starter-tier shop is redirected
// to /shop before any of this renders.
//
// The catalogs behind this page (hd_parts_reference, hd_parts, hd_parts_cross_ref)
// are shared, global, published manufacturer specs. This page only reads them.
// The one thing it writes is the shop's OWN inventory, via the existing
// /api/shop/inventory route, and only for a user with manageInventory.

import type { Metadata } from 'next'
import Link from 'next/link'
import PageHeader from '@/components/page-header'
import { requireFeature } from '@/lib/auth'
import { FEATURE_LABELS } from '@/lib/permissions'
import { primaryPartNumber, searchParts } from '@/lib/shop/parts-reference'
import AddToInventory from './_components/add-to-inventory'

export const metadata: Metadata = { title: FEATURE_LABELS.parts_reference }

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export default async function PartsReferencePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireFeature('parts_reference')

  const params = await searchParams
  const q = first(params.q).trim()
  const manufacturer = first(params.manufacturer).trim()
  const category = first(params.category).trim()

  const searched = Boolean(q || manufacturer || category)

  // Always call searchParts: even with no query it supplies the filter options,
  // and it caps the row count itself.
  const result = await searchParts({
    q,
    manufacturer,
    category,
    limit: searched ? 150 : 1,
  })

  const canStock = ctx.permissions.manageInventory

  return (
    <div className="space-y-6">
      <PageHeader
        title={FEATURE_LABELS.parts_reference}
        subtitle="OEM part numbers cross-referenced to Baldwin, NAPA Gold, Donaldson, Fleetguard, WIX, Gates and more."
      />

      <form method="get" className="nwi-card space-y-4 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <label className="nwi-label" htmlFor="q">
              Part number or description
            </label>
            <input
              id="q"
              name="q"
              defaultValue={q}
              placeholder="11-9959, oil filter, serpentine belt"
              autoComplete="off"
              className="nwi-input !min-h-14 !text-lg"
            />
          </div>

          <div>
            <label className="nwi-label" htmlFor="manufacturer">
              Manufacturer
            </label>
            <select
              id="manufacturer"
              name="manufacturer"
              defaultValue={manufacturer}
              className="nwi-select !min-h-14"
            >
              <option value="">All</option>
              {result.manufacturers.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="nwi-label" htmlFor="category">
              Category
            </label>
            <select
              id="category"
              name="category"
              defaultValue={category}
              className="nwi-select !min-h-14"
            >
              <option value="">All</option>
              {result.categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="submit" className="nwi-btn nwi-btn-primary !min-h-14 !px-8 !text-lg">
            Search
          </button>
          {searched ? (
            <Link
              href="/shop/tools/parts-reference"
              className="nwi-btn nwi-btn-secondary !min-h-14 !text-lg"
            >
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {result.degraded ? (
        <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
          <p className="text-base font-semibold leading-relaxed text-amber-900">
            Part of the reference catalog could not be loaded. Anything shown
            below is accurate, but the list may be incomplete — check again
            before ordering.
          </p>
        </section>
      ) : null}

      {!searched ? (
        <section className="nwi-card p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">
            Search the cross-reference catalog
          </h2>
          <p className="mt-2 text-base leading-relaxed text-slate-600">
            Enter an OEM number, an aftermarket number, or what the part is.
            Numbers match with or without dashes and spaces, and an exact number
            is listed first. Cross-references from every brand on file are shown
            for each hit.
          </p>
        </section>
      ) : result.results.length === 0 ? (
        <section className="nwi-card p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">No match</h2>
          <p className="mt-2 text-base leading-relaxed text-slate-600">
            Nothing in the catalog matches that. Try the number without a prefix,
            or search by what the part does instead.
          </p>
        </section>
      ) : (
        <section className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-wider text-slate-600">
            {result.total} part{result.total === 1 ? '' : 's'}
            {result.total > result.results.length
              ? ` — showing the first ${result.results.length}`
              : ''}
          </p>

          {/* Wide table: it scrolls inside its own container so the page body
              never scrolls sideways on a tablet. */}
          <div className="nwi-card overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-600">
                    OEM number
                  </th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-600">
                    Description
                  </th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-600">
                    Manufacturer
                  </th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-600">
                    Cross-references
                  </th>
                  {canStock ? (
                    <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-600">
                      Stock it
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {result.results.map((part) => (
                  <tr key={part.key} className="border-b border-slate-100 align-top">
                    <td className="px-4 py-4">
                      <span className="font-mono text-base font-bold text-slate-900">
                        {part.oemPartNumber ?? '—'}
                      </span>
                      {part.supersededBy ? (
                        <span className="mt-1 block text-xs font-semibold uppercase tracking-wider text-amber-700">
                          Superseded by {part.supersededBy}
                        </span>
                      ) : null}
                      {part.fieldCritical ? (
                        <span className="mt-1 block text-xs font-semibold uppercase tracking-wider text-red-700">
                          Field critical
                        </span>
                      ) : null}
                    </td>

                    <td className="px-4 py-4">
                      {/* description already folds in the category — see
                          referenceToMatch in lib/shop/parts-reference.ts. */}
                      <span className="text-base text-slate-900">{part.description}</span>
                      {part.unitFamily ? (
                        <span className="mt-1 block text-sm text-slate-600">
                          {part.unitFamily}
                        </span>
                      ) : null}
                      {part.notes ? (
                        <span className="mt-1 block text-sm text-slate-500">{part.notes}</span>
                      ) : null}
                    </td>

                    <td className="px-4 py-4 text-base text-slate-700">
                      {part.manufacturer ?? '—'}
                    </td>

                    <td className="px-4 py-4">
                      {part.crossRefs.length === 0 ? (
                        <span className="text-sm text-slate-500">None on file</span>
                      ) : (
                        <ul className="space-y-1">
                          {part.crossRefs.map((ref) => (
                            <li key={`${ref.brand}-${ref.part}`} className="text-sm">
                              <span className="font-semibold text-slate-600">
                                {ref.brand}
                              </span>{' '}
                              <span className="font-mono text-base font-bold text-slate-900">
                                {ref.part}
                              </span>
                              {ref.notes ? (
                                <span className="block text-xs text-slate-500">
                                  {ref.notes}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>

                    {canStock ? (
                      <td className="px-4 py-4">
                        {part.oemPartNumber ? (
                          <AddToInventory
                            partNumber={primaryPartNumber(part.oemPartNumber)}
                            description={part.description}
                            manufacturer={part.manufacturer}
                            canSeeCost={ctx.permissions.viewMargins}
                          />
                        ) : (
                          <span className="text-sm text-slate-500">No part number</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="nwi-card p-5 sm:p-6">
        <p className="text-sm leading-relaxed text-slate-600">
          Cross-references are published manufacturer equivalents and are provided
          as a starting point. Confirm fitment against the unit&apos;s model and
          serial before ordering or installing.
        </p>
      </section>

      <div>
        <Link href="/shop/tools" className="nwi-btn nwi-btn-secondary">
          Back to Tools
        </Link>
      </div>
    </div>
  )
}

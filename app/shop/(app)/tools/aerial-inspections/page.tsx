// /shop/tools/aerial-inspections — the filed aerial-device inspections, plus the
// cadence chooser that starts a new one.
//
// requireFeature() is the FIRST statement in the component, so a shop without the
// feature is redirected to /shop before any of this page renders or any query
// runs. NWI Suite's equivalent POST route had no gate on it at all.

import type { Metadata } from 'next'
import Link from 'next/link'
import EmptyState from '@/components/empty-state'
import PageHeader from '@/components/page-header'
import { requireFeature } from '@/lib/auth'
import { FEATURE_LABELS } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import {
  AERIAL_CADENCES,
  type AerialCadence,
} from '@/lib/shop/inspections/types'
import {
  AERIAL_CADENCE_LABELS,
  AERIAL_FORMS,
  AERIAL_INTERVAL_DAYS,
} from '@/lib/shop/inspections/aerial-forms'
import InspectionTable from '@/lib/shop/inspections/components/inspection-table'
import { listInspections } from '@/lib/shop/inspections/query'

export const metadata: Metadata = { title: FEATURE_LABELS.aerial_inspections }

export default async function AerialInspectionsPage() {
  const ctx = await requireFeature('aerial_inspections')

  const supabase = await createClient()
  const { inspections, warning } = await listInspections(supabase, ctx.shop.id, {
    types: ['aerial'],
    limit: 100,
  })

  const outOfService = inspections.filter((row) => row.removed_from_service).length
  const lastByCadence = new Map<AerialCadence, string>()
  for (const inspection of inspections) {
    // The list is newest first, so the first hit per cadence is the latest.
    if (inspection.cadence && !lastByCadence.has(inspection.cadence)) {
      lastByCadence.set(inspection.cadence, inspection.signed_at ?? inspection.created_at)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={FEATURE_LABELS.aerial_inspections}
        subtitle="OSHA 29 CFR 1926.453 · ANSI/SAIA A92"
      />

      <section>
        <h2 className="text-base font-semibold text-slate-900">Start an inspection</h2>
        <p className="mt-1 text-sm text-slate-600">
          The three cadences are cumulative: frequent is the pre-use checklist plus
          its own tests, and annual is both plus the load test and certification.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {AERIAL_CADENCES.map((cadence) => {
            const form = AERIAL_FORMS[cadence]
            const items = form.sections.reduce((sum, section) => sum + section.items.length, 0)
            const last = lastByCadence.get(cadence)
            return (
              <Link
                key={cadence}
                href={`/shop/tools/aerial-inspections/new?cadence=${cadence}`}
                className="nwi-card block p-5 transition hover:shadow-md"
              >
                <h3 className="text-base font-semibold text-slate-900">
                  {AERIAL_CADENCE_LABELS[cadence]}
                </h3>
                <p className="mt-1 text-sm text-slate-600">{form.requirement}</p>
                <p className="mt-3 text-xs text-slate-500">
                  {form.sections.length} sections · {items} items · every{' '}
                  {AERIAL_INTERVAL_DAYS[cadence]} day
                  {AERIAL_INTERVAL_DAYS[cadence] === 1 ? '' : 's'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {last ? `Last filed ${last.slice(0, 10)}` : 'None filed yet'}
                </p>
              </Link>
            )
          })}
        </div>
      </section>

      {warning && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-base font-semibold text-amber-900">Inspection records unavailable</h2>
          <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
            The inspections table could not be read, so nothing is listed below.
            This is expected until migration <code>009_shop_inspections.sql</code> has
            been applied in the Supabase SQL editor.
          </p>
          <p className="mt-2 font-mono text-xs text-amber-900/80">{warning}</p>
        </section>
      )}

      {outOfService > 0 && (
        <section className="rounded-xl border border-red-200 bg-red-50 p-5">
          <h2 className="text-base font-semibold text-red-900">
            {outOfService} machine{outOfService === 1 ? '' : 's'} removed from service
          </h2>
          <p className="mt-2 text-sm text-red-900/90">
            Under OSHA 1926.453 these machines may not be operated until the defects
            are repaired.
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Filed inspections</h2>
        {inspections.length === 0 ? (
          <EmptyState
            title={warning ? 'Nothing to show yet' : 'No aerial inspections filed'}
            description={
              warning
                ? 'Apply migration 009 and this list will fill in as inspections are filed.'
                : 'Pick a cadence above to file the first one. Each produces a printable, signed record.'
            }
          />
        ) : (
          <InspectionTable inspections={inspections} showCadence />
        )}
      </section>
    </div>
  )
}

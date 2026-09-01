// /shop/tools/dot-inspections — the filed DOT annual inspections.
//
// requireFeature() is the FIRST statement in the component, so a light-duty shop
// (or one on a plan without it) is redirected to /shop before any of this page
// renders or any query runs.

import type { Metadata } from 'next'
import Link from 'next/link'
import EmptyState from '@/components/empty-state'
import PageHeader from '@/components/page-header'
import { requireFeature } from '@/lib/auth'
import { FEATURE_LABELS } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import InspectionTable from '@/lib/shop/inspections/components/inspection-table'
import { DOT_FORM } from '@/lib/shop/inspections/dot-categories'
import { listInspections } from '@/lib/shop/inspections/query'

export const metadata: Metadata = { title: FEATURE_LABELS.dot_inspections }

export default async function DotInspectionsPage() {
  const ctx = await requireFeature('dot_inspections')

  const supabase = await createClient()
  const { inspections, warning } = await listInspections(supabase, ctx.shop.id, {
    types: ['dot'],
    limit: 100,
  })

  const outOfService = inspections.filter((row) => row.removed_from_service).length
  const failed = inspections.filter((row) => row.result === 'fail').length

  return (
    <div className="space-y-6">
      <PageHeader
        title={FEATURE_LABELS.dot_inspections}
        subtitle={DOT_FORM.citation}
        actions={
          <Link href="/shop/tools/dot-inspections/new" className="nwi-btn nwi-btn-primary">
            New inspection
          </Link>
        }
      />

      <section className="nwi-card p-5">
        <h2 className="text-base font-semibold text-slate-900">{DOT_FORM.title}</h2>
        <p className="mt-1 text-sm text-slate-600">{DOT_FORM.requirement}</p>
        <p className="mt-2 text-sm text-slate-600">
          The form walks all {DOT_FORM.sections.length} CVSA categories. A filed
          inspection is signed and locked — it cannot be edited afterwards, and a
          correction is a new inspection.
        </p>
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
            {outOfService} unit{outOfService === 1 ? '' : 's'} removed from service
          </h2>
          <p className="mt-2 text-sm text-red-900/90">
            Under 49 CFR 396.9 these units may not be operated until the defects are
            repaired and they are re-inspected.
          </p>
        </section>
      )}

      {inspections.length === 0 ? (
        <EmptyState
          title={warning ? 'Nothing to show yet' : 'No DOT inspections filed'}
          description={
            warning
              ? 'Apply migration 009 and this list will fill in as inspections are filed.'
              : 'File the first annual inspection and it will appear here with a printable certificate.'
          }
          action={
            warning ? undefined : (
              <Link href="/shop/tools/dot-inspections/new" className="nwi-btn nwi-btn-primary">
                New inspection
              </Link>
            )
          }
        />
      ) : (
        <>
          <p className="text-sm text-slate-500">
            {inspections.length} filed · {failed} failed
          </p>
          <InspectionTable inspections={inspections} />
        </>
      )}
    </div>
  )
}

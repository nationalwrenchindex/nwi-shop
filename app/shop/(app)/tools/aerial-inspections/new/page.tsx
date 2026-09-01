// /shop/tools/aerial-inspections/new?cadence=pre_use|frequent|annual
//
// requireFeature() is the FIRST statement, before searchParams is awaited and
// before any query runs. An unrecognised cadence sends the user back to the
// chooser rather than rendering a form with no checklist behind it.

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/page-header'
import { requireFeature } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { AERIAL_FORMS } from '@/lib/shop/inspections/aerial-forms'
import ChecklistForm from '@/lib/shop/inspections/components/checklist-form'
import { loadFormOptions } from '@/lib/shop/inspections/form-options'
import { isAerialCadence } from '@/lib/shop/inspections/types'

export const metadata: Metadata = { title: 'New aerial inspection' }

export default async function NewAerialInspectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireFeature('aerial_inspections')

  const params = await searchParams
  const raw = Array.isArray(params.cadence) ? params.cadence[0] : params.cadence
  if (!isAerialCadence(raw)) redirect('/shop/tools/aerial-inspections')

  const def = AERIAL_FORMS[raw]
  const supabase = await createClient()
  const options = await loadFormOptions(supabase, ctx.shop.id)

  return (
    <div className="space-y-6">
      <PageHeader title={def.title} subtitle={def.citation} />

      <ChecklistForm
        def={def}
        jobs={options.jobs}
        vehicles={options.vehicles}
        customers={options.customers}
        techs={options.techs}
        currentTechId={ctx.tech.id}
        currentTechName={`${ctx.tech.first_name} ${ctx.tech.last_name}`.trim()}
        defaultCertNumber=""
        canFileForOthers={ctx.permissions.viewAllJobs}
        returnHref="/shop/tools/aerial-inspections"
      />
    </div>
  )
}

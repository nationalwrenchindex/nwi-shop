// /shop/tools/dot-inspections/new — the DOT annual inspection form.
//
// requireFeature() is the FIRST statement, before any query runs.

import type { Metadata } from 'next'
import PageHeader from '@/components/page-header'
import { requireFeature } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import ChecklistForm from '@/lib/shop/inspections/components/checklist-form'
import { DOT_FORM } from '@/lib/shop/inspections/dot-categories'
import { loadFormOptions } from '@/lib/shop/inspections/form-options'

export const metadata: Metadata = { title: 'New DOT inspection' }

export default async function NewDotInspectionPage() {
  const ctx = await requireFeature('dot_inspections')

  const supabase = await createClient()
  const options = await loadFormOptions(supabase, ctx.shop.id)

  return (
    <div className="space-y-6">
      <PageHeader title={DOT_FORM.title} subtitle={DOT_FORM.citation} />

      <ChecklistForm
        def={DOT_FORM}
        jobs={options.jobs}
        vehicles={options.vehicles}
        customers={options.customers}
        techs={options.techs}
        currentTechId={ctx.tech.id}
        currentTechName={`${ctx.tech.first_name} ${ctx.tech.last_name}`.trim()}
        // There is no inspector-credential column on the shop profile, so this
        // is typed per inspection rather than guessed from an unrelated one.
        defaultCertNumber=""
        canFileForOthers={ctx.permissions.viewAllJobs}
        returnHref="/shop/tools/dot-inspections"
      />
    </div>
  )
}

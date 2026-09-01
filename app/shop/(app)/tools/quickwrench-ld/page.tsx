// /shop/tools/quickwrench-ld — light-duty diagnostics.
//
// Gated on the shop TYPE and the tier, not the user's role. requireFeature() is
// the FIRST statement in the component, so a heavy-duty-only shop or a Starter
// shop is redirected to /shop before any of this renders.
//
// Server Component. The only work done here is resolving the caller's open jobs
// so the workspace can attach a finding to one; every lookup is on demand from
// the client.

import type { Metadata } from 'next'
import PageHeader from '@/components/page-header'
import { requireFeature } from '@/lib/auth'
import { isGeminiConfigured } from '@/lib/gemini'
import { FEATURE_LABELS } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import type { ShopJob, ShopVehicle } from '@/lib/types'
import Workspace from './_components/workspace'
import type { JobOption, WorkVehicle } from './_components/types'

export const metadata: Metadata = { title: FEATURE_LABELS.quickwrench_ld }

/** Jobs still on the floor. An invoiced job is history, not somewhere to attach. */
const OPEN_STATUSES = ['estimate', 'approved', 'in_progress'] as const

export default async function QuickWrenchLdPage() {
  const ctx = await requireFeature('quickwrench_ld')

  const jobs = await loadOpenJobs(ctx.shop.id, ctx.permissions.viewAllJobs ? null : ctx.tech.id)

  return (
    <div className="space-y-6">
      <PageHeader
        title={FEATURE_LABELS.quickwrench_ld}
        subtitle="Codes, symptoms, recalls and OEM specs for cars and light trucks."
      />
      <Workspace jobs={jobs} aiEnabled={isGeminiConfigured()} />
    </div>
  )
}

/**
 * Open jobs the caller may attach to, with their vehicle. Scoped by shop and,
 * for a tech, to their own assignments — the same rule the jobs API enforces,
 * applied here so the picker never lists a job the write would reject.
 */
async function loadOpenJobs(shopId: string, techId: string | null): Promise<JobOption[]> {
  const supabase = await createClient()

  const query = supabase
    .from('shop_jobs')
    .select('*')
    .eq('shop_id', shopId)
    .eq('voided', false)
    .in('status', [...OPEN_STATUSES])
    .order('job_number', { ascending: false })
    .limit(100)

  const scoped = techId ? query.eq('assigned_tech_id', techId) : query
  const { data: jobRows } = await scoped.returns<ShopJob[]>()
  const jobs = jobRows ?? []
  if (jobs.length === 0) return []

  const vehicleIds = [
    ...new Set(jobs.map((j) => j.vehicle_id).filter((v): v is string => v !== null)),
  ]

  const vehiclesById = new Map<string, ShopVehicle>()
  if (vehicleIds.length > 0) {
    const { data: vehicleRows } = await supabase
      .from('shop_vehicles')
      .select('*')
      .eq('shop_id', shopId)
      .in('id', vehicleIds)
      .returns<ShopVehicle[]>()

    for (const v of vehicleRows ?? []) vehiclesById.set(v.id, v)
  }

  return jobs.map((job) => ({
    id:         job.id,
    job_number: job.job_number,
    status:     job.status,
    summary:    (job.complaint ?? job.description ?? 'No complaint recorded').slice(0, 60),
    notes:      job.notes,
    vehicle:    job.vehicle_id ? toWorkVehicle(vehiclesById.get(job.vehicle_id)) : null,
  }))
}

function toWorkVehicle(vehicle: ShopVehicle | undefined): WorkVehicle | null {
  if (!vehicle) return null
  return {
    vin:    vehicle.vin ?? '',
    year:   vehicle.year === null ? '' : String(vehicle.year),
    make:   vehicle.make ?? '',
    model:  vehicle.model ?? '',
    engine: vehicle.engine ?? '',
    trim:   '',
  }
}

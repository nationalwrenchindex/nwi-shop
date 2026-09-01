// GET    /api/shop/jobs/[id]  - one job with its line items (cost fields are
//                               stripped server-side unless `viewMargins`).
// PATCH  /api/shop/jobs/[id]  - status advance, bay/tech assignment, notes.
// DELETE /api/shop/jobs/[id]  - soft delete: sets `voided` and frees the bay.
//
// Role rules enforced here, not in the UI:
//   - manager / foreman (`viewAllJobs`) may touch any job in their shop.
//   - a tech may read only jobs assigned to them, and may only edit `notes`.
// Every write re-checks that the row's shop_id matches the caller's shop.

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { enqueueReviewRequest } from '@/lib/shop/torquewrench/enqueue'
import {
  apiError,
  asNumber,
  asText,
  bayEffectForStatus,
  canAdvance,
  isJobStatus,
  jobPatchForStatus,
  loadJobDetail,
  readJsonBody,
  summarizeLineItems,
  toLineItemView,
} from '@/lib/shop/jobs'
import type { JobStatus, ShopBay, ShopJob } from '@/lib/types'

type Params = { params: Promise<{ id: string }> }

/** Fields a PATCH is allowed to write on shop_jobs. */
type JobPatch = Partial<
  Pick<
    ShopJob,
    | 'status'
    | 'bay_id'
    | 'assigned_tech_id'
    | 'bay_assigned_at'
    | 'completed_at'
    | 'invoiced_at'
    | 'notes'
    | 'complaint'
    | 'description'
    | 'estimated_hours'
    | 'voided'
  >
>

export async function GET(_req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext()
  if (error) return error

  const { id } = await params
  const supabase = await createClient()
  const detail = await loadJobDetail(supabase, id, {
    shopId: ctx.shop.id,
    techId: ctx.permissions.viewAllJobs ? null : ctx.tech.id,
  })
  if (!detail) return apiError('Job not found.', 404)

  const viewMargins = ctx.permissions.viewMargins
  const lineItems = detail.lineItems.map((row) => toLineItemView(row, viewMargins))

  return Response.json({
    job:      detail.job,
    customer: detail.customer,
    vehicle:  detail.vehicle,
    bay:      detail.bay,
    tech:     detail.tech
      ? {
          id:         detail.tech.id,
          first_name: detail.tech.first_name,
          last_name:  detail.tech.last_name,
          active:     detail.tech.active,
        }
      : null,
    lineItems,
    totals:   summarizeLineItems(lineItems, ctx.shop.tax_rate, viewMargins),
    advance:  canAdvance(detail.job),
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext()
  if (error) return error

  const { id } = await params
  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const supabase = await createClient()

  const { data: job } = await supabase
    .from('shop_jobs')
    .select('*')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<ShopJob>()

  if (!job) return apiError('Job not found.', 404)
  if (job.voided) return apiError('This job has been voided.', 409)

  const isFloorManager = ctx.permissions.viewAllJobs
  if (!isFloorManager) {
    if (job.assigned_tech_id !== ctx.tech.id) return apiError('Job not found.', 404)
    // A tech may leave notes on their own job and nothing else.
    const allowed = new Set(['notes'])
    const attempted = Object.keys(body).filter((key) => !allowed.has(key))
    if (attempted.length) {
      return apiError('Techs may only update notes on their own jobs.', 403)
    }
  }

  const patch: JobPatch = {}
  const now = new Date().toISOString()

  if ('notes' in body) patch.notes = asText(body.notes)

  if (isFloorManager) {
    if ('complaint' in body) patch.complaint = asText(body.complaint)
    if ('description' in body) patch.description = asText(body.description)
    if ('estimated_hours' in body) {
      const hours = asNumber(body.estimated_hours)
      if (hours !== null && hours < 0) return apiError('Estimated hours cannot be negative.', 400)
      patch.estimated_hours = hours
    }
  }

  // ---- tech assignment -----------------------------------------------------
  let nextTechId = job.assigned_tech_id
  if (isFloorManager && 'assigned_tech_id' in body) {
    const techId = asText(body.assigned_tech_id)
    if (techId) {
      const { data: tech } = await supabase
        .from('shop_techs')
        .select('id')
        .eq('id', techId)
        .eq('shop_id', ctx.shop.id)
        .eq('active', true)
        .maybeSingle<{ id: string }>()
      if (!tech) return apiError('Tech not found in this shop.', 404)
    }
    nextTechId = techId
    patch.assigned_tech_id = techId
  }

  // ---- bay assignment ------------------------------------------------------
  let nextBayId = job.bay_id
  let targetBay: ShopBay | null = null
  if (isFloorManager && 'bay_id' in body) {
    const bayId = asText(body.bay_id)
    if (bayId) {
      const { data: bay } = await supabase
        .from('shop_bays')
        .select('*')
        .eq('id', bayId)
        .eq('shop_id', ctx.shop.id)
        .maybeSingle<ShopBay>()
      if (!bay) return apiError('Bay not found in this shop.', 404)
      if (bay.status === 'out_of_service') return apiError('That bay is out of service.', 409)
      if (bay.status === 'occupied' && bay.current_job_id && bay.current_job_id !== job.id) {
        return apiError('That bay is already occupied.', 409)
      }
      targetBay = bay
    }
    nextBayId = bayId
    patch.bay_id = bayId
    patch.bay_assigned_at = bayId ? now : null
  }

  // ---- status advance ------------------------------------------------------
  let advancedTo: JobStatus | null = null
  const wantsAdvance = body.advance === true || 'status' in body
  if (wantsAdvance) {
    if (!isFloorManager) return apiError('Techs cannot change job status.', 403)

    const check = canAdvance({
      status:           job.status,
      bay_id:           nextBayId,
      assigned_tech_id: nextTechId,
      voided:           job.voided,
    })
    if (!check.ok || !check.next) return apiError(check.reason ?? 'Cannot advance this job.', 409)

    if ('status' in body) {
      const requested = body.status
      if (!isJobStatus(requested)) return apiError('Unknown status.', 400)
      if (requested !== check.next) {
        return apiError(`This job can only move to "${check.next}".`, 409)
      }
    }

    advancedTo = check.next
    Object.assign(patch, jobPatchForStatus(check.next, now))
    if (check.next === 'in_progress' && !patch.bay_assigned_at && job.bay_assigned_at) {
      // Already sitting in its bay - keep the original clock.
      patch.bay_assigned_at = job.bay_assigned_at
    }
  }

  if (Object.keys(patch).length === 0) return apiError('Nothing to update.', 400)

  const { data: updated, error: updateError } = await supabase
    .from('shop_jobs')
    .update(patch)
    .eq('id', job.id)
    .eq('shop_id', ctx.shop.id)
    .select('*')
    .maybeSingle<ShopJob>()

  if (updateError || !updated) {
    return apiError(updateError?.message ?? 'Could not update the job.', 400)
  }

  // ---- bay side effects ----------------------------------------------------
  // Applied after the job write so a failed update never strands a bay.
  const freeing = advancedTo ? bayEffectForStatus(advancedTo) === 'free' : false

  if (job.bay_id && job.bay_id !== nextBayId) {
    await releaseBay(supabase, ctx.shop.id, job.bay_id, job.id)
  }
  if (nextBayId && freeing) {
    await releaseBay(supabase, ctx.shop.id, nextBayId, job.id)
  } else if (nextBayId && (targetBay || advancedTo === 'in_progress')) {
    await supabase
      .from('shop_bays')
      .update({ status: 'occupied', current_job_id: job.id })
      .eq('id', nextBayId)
      .eq('shop_id', ctx.shop.id)
  }

  // ---- review request ------------------------------------------------------
  // Finishing a job is what triggers TorqueWrench (NWI Suite fired on invoice
  // paid instead). Deliberately best-effort and last: a shop with reviews turned
  // off, a customer with no phone, or an unapplied migration must never stop a
  // tech from marking their work done. enqueueReviewRequest never throws and
  // dedupes on job_id, so a re-advance cannot double-text a customer.
  if (advancedTo === 'completed') {
    try {
      await enqueueReviewRequest(supabase, ctx.shop.id, job.id)
    } catch (err) {
      console.error('[jobs] review enqueue failed (ignored):', err)
    }
  }

  return Response.json({ job: updated })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext('viewAllJobs')
  if (error) return error

  const { id } = await params
  const supabase = await createClient()

  const { data: job } = await supabase
    .from('shop_jobs')
    .select('*')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<ShopJob>()
  if (!job) return apiError('Job not found.', 404)

  const { error: updateError } = await supabase
    .from('shop_jobs')
    .update({ voided: true })
    .eq('id', job.id)
    .eq('shop_id', ctx.shop.id)
  if (updateError) return apiError(updateError.message, 400)

  if (job.bay_id) await releaseBay(supabase, ctx.shop.id, job.bay_id, job.id)

  return Response.json({ ok: true })
}

/**
 * Returns a bay to `available` only when it is the one this job is sitting in.
 * An `out_of_service` bay stays out of service.
 */
async function releaseBay(
  supabase: Awaited<ReturnType<typeof createClient>>,
  shopId: string,
  bayId: string,
  jobId: string,
): Promise<void> {
  const { data: bay } = await supabase
    .from('shop_bays')
    .select('*')
    .eq('id', bayId)
    .eq('shop_id', shopId)
    .maybeSingle<ShopBay>()
  if (!bay) return
  if (bay.current_job_id && bay.current_job_id !== jobId) return

  await supabase
    .from('shop_bays')
    .update({
      status: bay.status === 'out_of_service' ? 'out_of_service' : 'available',
      current_job_id: null,
    })
    .eq('id', bayId)
    .eq('shop_id', shopId)
}

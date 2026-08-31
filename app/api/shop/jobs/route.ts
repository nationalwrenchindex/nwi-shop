// GET  /api/shop/jobs  - role-scoped job list for the board.
//   ?status=<JobStatus>  filter to one status
//   ?unassigned=true     only jobs with no bay that are not finished
// POST /api/shop/jobs    - create a job in `estimate` status.
//
// A tech may read only their own jobs and may not create one. `viewAllJobs` is
// the floor-manager gate: true for manager + foreman, false for tech.

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  apiError,
  isJobStatus,
  loadJobBoard,
  readJsonBody,
  asNumber,
  asText,
  unassignedJobs,
} from '@/lib/shop/jobs'
import type { ShopCustomer, ShopJob, ShopVehicle } from '@/lib/types'

export async function GET(req: NextRequest) {
  const { ctx, error } = await apiContext()
  if (error) return error

  const supabase = await createClient()
  const board = await loadJobBoard(supabase, {
    shopId: ctx.shop.id,
    techId: ctx.permissions.viewAllJobs ? null : ctx.tech.id,
  })

  let jobs = board.jobs
  const status = req.nextUrl.searchParams.get('status')
  if (status) {
    if (!isJobStatus(status)) return apiError('Unknown status filter.', 400)
    jobs = jobs.filter((job) => job.status === status)
  }
  if (req.nextUrl.searchParams.get('unassigned') === 'true') {
    jobs = unassignedJobs(jobs)
  }

  return Response.json({ jobs })
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await apiContext('viewAllJobs')
  if (error) return error

  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const customerId = asText(body.customer_id)
  const vehicleId = asText(body.vehicle_id)
  const complaint = asText(body.complaint)
  const description = asText(body.description)
  const estimatedHours = asNumber(body.estimated_hours)
  const assignedTechId = asText(body.assigned_tech_id)

  if (!complaint && !description) {
    return apiError('A complaint or description is required.', 400)
  }
  if (estimatedHours !== null && estimatedHours < 0) {
    return apiError('Estimated hours cannot be negative.', 400)
  }

  const supabase = await createClient()

  // Every referenced row must belong to the caller's shop.
  if (customerId) {
    const { data: customer } = await supabase
      .from('shop_customers')
      .select('id')
      .eq('id', customerId)
      .eq('shop_id', ctx.shop.id)
      .maybeSingle<Pick<ShopCustomer, 'id'>>()
    if (!customer) return apiError('Customer not found in this shop.', 404)
  }

  if (vehicleId) {
    const { data: vehicle } = await supabase
      .from('shop_vehicles')
      .select('id, customer_id')
      .eq('id', vehicleId)
      .eq('shop_id', ctx.shop.id)
      .maybeSingle<Pick<ShopVehicle, 'id' | 'customer_id'>>()
    if (!vehicle) return apiError('Vehicle not found in this shop.', 404)
    if (customerId && vehicle.customer_id !== customerId) {
      return apiError('That vehicle belongs to a different customer.', 400)
    }
  }

  if (assignedTechId) {
    const { data: tech } = await supabase
      .from('shop_techs')
      .select('id')
      .eq('id', assignedTechId)
      .eq('shop_id', ctx.shop.id)
      .eq('active', true)
      .maybeSingle<{ id: string }>()
    if (!tech) return apiError('Tech not found in this shop.', 404)
  }

  // Job numbers are per shop and human-facing, so they are allocated from the
  // current maximum rather than a global sequence.
  const { data: last } = await supabase
    .from('shop_jobs')
    .select('job_number')
    .eq('shop_id', ctx.shop.id)
    .order('job_number', { ascending: false })
    .limit(1)
    .maybeSingle<Pick<ShopJob, 'job_number'>>()

  const jobNumber = (Number(last?.job_number) || 0) + 1

  const { data: job, error: insertError } = await supabase
    .from('shop_jobs')
    .insert({
      shop_id:          ctx.shop.id,
      customer_id:      customerId,
      vehicle_id:       vehicleId,
      assigned_tech_id: assignedTechId,
      job_number:       jobNumber,
      status:           'estimate',
      complaint,
      description,
      estimated_hours:  estimatedHours,
      voided:           false,
    })
    .select('*')
    .maybeSingle<ShopJob>()

  if (insertError || !job) {
    return apiError(insertError?.message ?? 'Could not create the job.', 400)
  }

  return Response.json({ job }, { status: 201 })
}

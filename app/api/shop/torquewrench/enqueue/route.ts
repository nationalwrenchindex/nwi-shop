// POST /api/shop/torquewrench/enqueue  { job_id }
//
// The seam between the job board and TorqueWrench. The jobs flow calls this when
// a job reaches `completed`; the review dashboard calls it too when a manager
// queues one by hand. It is deliberately an endpoint rather than a direct import
// into the jobs route so the two areas stay independently deployable — and so
// this build could add it without editing app/api/shop/jobs/[id]/route.ts.
//
// It NEVER fails the caller's own work. Queuing a review request is a bonus on
// top of closing a job; a 200 with `enqueued: false` and a named reason is the
// normal, expected outcome for a shop that has the feature switched off or a
// customer with no phone. The jobs route should ignore the response body
// entirely and must not surface a failure here to the tech marking the job done.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, asText, readJsonBody } from '@/lib/shop/jobs'
import { enqueueReviewRequest } from '@/lib/shop/torquewrench/enqueue'

export async function POST(req: NextRequest) {
  // manageCustomers, not viewAllJobs: this puts a text in front of a customer,
  // which is a customer-contact action even though a job triggers it.
  const { ctx, error } = await apiFeature('torquewrench', 'manageCustomers')
  if (error) return error

  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const jobId = asText(body.job_id)
  if (!jobId) return apiError('A job_id is required.', 400)

  const supabase = await createClient()
  const result = await enqueueReviewRequest(supabase, ctx.shop.id, jobId)

  return Response.json(result)
}

// GET /api/shop/timeclock?tech_id=&from=&to=
//
// Punch history. A `tech` caller is force-scoped to their own id: the parameter
// is overwritten before the query is built, so no crafted query string can
// widen the scope. Managers and foremen may read any tech in their own shop.

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { JobRef, PunchesResponse } from '@/lib/shop/timeclock'
import { fetchJobsByIds, fetchPunches, parseRange } from './_queries'

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await apiContext()
  if (!auth.ctx) return auth.error
  const ctx = auth.ctx

  const params = request.nextUrl.searchParams

  // Force-scope, do not validate: a tech always reads their own row set.
  if (ctx.role === 'tech') params.set('tech_id', ctx.tech.id)
  const techId = params.get('tech_id') ?? undefined

  const now = new Date()
  const range = parseRange(params, now)

  const supabase = await createClient()

  const punches = await fetchPunches(supabase, {
    shopId: ctx.shop.id,
    techId,
    from: range.from,
    to: range.to,
  })

  const jobs = await fetchJobsByIds(
    supabase,
    ctx.shop.id,
    punches.map((p) => p.job_id).filter((id): id is string => id !== null),
  )

  const jobRefs: JobRef[] = jobs.map((job) => ({
    id: job.id,
    job_number: job.job_number,
    description: job.description,
  }))

  const payload: PunchesResponse = {
    now: now.toISOString(),
    from: range.fromKey,
    to: range.toKey,
    punches,
    jobs: jobRefs,
  }

  return Response.json(payload)
}

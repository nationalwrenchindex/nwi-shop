// The enqueue rule for a review request.
//
// ── WHAT CHANGED FROM THE SUITE ─────────────────────────────────────────────
// NWI Suite queued a review request when an INVOICE was marked paid. NWI Shop
// queues it when a JOB reaches `completed`. That is the moment the customer is
// standing at the counter with the keys in their hand and the work fresh in
// mind; waiting for payment to clear puts the text days later, sometimes after a
// fleet account settles at month end, and the response rate collapses.
//
// The enqueue is deliberately NOT the send. This writes a `pending` row and
// stops; app/api/cron/torquewrench-send does the sending once the shop's
// delay_minutes has elapsed since the job completed. That split is what lets a
// shop set an hour's delay, and what keeps a failed Twilio call from being tied
// to the request that closed the job.
//
// ── DEDUPE ──────────────────────────────────────────────────────────────────
// A job can never be double-enqueued. There is a unique index on
// shop_review_requests.job_id and THAT is the guarantee — the pre-check below is
// only there to return a friendly reason instead of a constraint error. Two
// concurrent "mark complete" clicks both pass the pre-check; the second one
// loses at the insert and is reported as already enqueued, not as a failure.

import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobStatus, ShopCustomer, ShopJob } from '@/lib/types'
import { isMissingSchema, loadReviewSettings } from './data'
import type { ShopReviewRequest } from './types'

export type EnqueueReason =
  | 'enqueued'
  | 'already_enqueued'
  | 'job_not_found'
  | 'job_voided'
  | 'job_not_completed'
  | 'no_customer'
  | 'no_phone'
  | 'customer_opted_out'
  | 'not_enabled'
  | 'no_google_place_id'
  | 'schema_missing'
  | 'insert_failed'

export interface EnqueueResult {
  enqueued: boolean
  reason:   EnqueueReason
  /** Plain-English version of `reason`, safe to show a shop manager. */
  message:  string
  requestId: string | null
  token:     string | null
  /**
   * True when a `skipped` row was written, so the outcome shows on the
   * dashboard instead of vanishing. Only set for customer-level refusals, which
   * can never become valid later.
   */
  recorded: boolean
}

function result(
  reason: EnqueueReason,
  message: string,
  extra: Partial<EnqueueResult> = {},
): EnqueueResult {
  return {
    enqueued: reason === 'enqueued',
    reason,
    message,
    requestId: null,
    token: null,
    recorded: false,
    ...extra,
  }
}

/**
 * Statuses from which a review request may be queued.
 *
 * `completed` is the trigger the user asked for. `invoiced` is accepted because
 * it is strictly downstream of completed — a job that was completed and then
 * invoiced before anything called this (or a manager re-running it by hand from
 * the dashboard) is still a finished job whose customer deserves the text. Any
 * earlier status is a hard no: the work is not done.
 */
const ENQUEUEABLE: readonly JobStatus[] = ['completed', 'invoiced']

/** Unguessable, URL-safe, and short enough not to bloat an SMS segment. */
function newToken(): string {
  return crypto.randomBytes(18).toString('base64url')
}

type JobFields = Pick<
  ShopJob,
  'id' | 'status' | 'voided' | 'customer_id' | 'completed_at' | 'description' | 'complaint'
>

type CustomerFields = Pick<ShopCustomer, 'id' | 'phone' | 'no_sms'>

/**
 * Queues a review request for a completed job.
 *
 * Never throws. Every refusal comes back as a named `reason` — a review request
 * that quietly does not happen is indistinguishable from one the customer
 * ignored, and a shop paying for this feature has to be able to tell those apart.
 */
export async function enqueueReviewRequest(
  supabase: SupabaseClient,
  shopId: string,
  jobId: string,
): Promise<EnqueueResult> {
  // ── The job ───────────────────────────────────────────────────────────────
  const { data: job, error: jobError } = await supabase
    .from('shop_jobs')
    .select('id, status, voided, customer_id, completed_at, description, complaint')
    .eq('id', jobId)
    .eq('shop_id', shopId)
    .maybeSingle<JobFields>()

  if (jobError) {
    return result('schema_missing', `Could not read the job: ${jobError.message}`)
  }
  if (!job) {
    return result('job_not_found', 'That job does not exist in this shop.')
  }
  if (job.voided) {
    return result('job_voided', 'This job was voided, so no review request was queued.')
  }
  if (!ENQUEUEABLE.includes(job.status)) {
    return result(
      'job_not_completed',
      'A review request is only queued once the job is marked complete.',
    )
  }

  // ── The shop's settings ───────────────────────────────────────────────────
  const { settings, tablesMissing } = await loadReviewSettings(supabase, shopId)
  if (tablesMissing) {
    return result(
      'schema_missing',
      'Review requests are not set up on this database yet.',
    )
  }
  if (!settings.is_enabled) {
    return result('not_enabled', 'Review requests are turned off for this shop.')
  }
  if (!settings.google_place_id) {
    // Queuing without one produces a request whose link goes nowhere. Refuse at
    // the front rather than accumulating rows the sender will skip forever.
    return result(
      'no_google_place_id',
      'Add your Google Place ID before review requests can be sent.',
    )
  }

  // ── The customer ──────────────────────────────────────────────────────────
  if (!job.customer_id) {
    return result('no_customer', 'This job has no customer attached, so there is nobody to text.')
  }

  const { data: customer } = await supabase
    .from('shop_customers')
    .select('id, phone, no_sms')
    .eq('id', job.customer_id)
    .eq('shop_id', shopId)
    .maybeSingle<CustomerFields>()

  if (!customer) {
    return result('no_customer', 'The customer on this job could not be read.')
  }

  const phone = customer.phone?.trim() || null

  // Both refusals below are permanent for this job, so they are written down as
  // a `skipped` row: the shop opens the dashboard, sees the job, and sees why.
  if (!phone) {
    const recorded = await recordSkip(supabase, shopId, job, customer.id, null, 'no phone on file')
    return result('no_phone', 'That customer has no phone number on file.', { recorded })
  }
  if (customer.no_sms) {
    const recorded = await recordSkip(
      supabase, shopId, job, customer.id, phone, 'customer opted out of SMS',
    )
    return result(
      'customer_opted_out',
      'That customer has asked not to receive texts.',
      { recorded },
    )
  }

  // ── Dedupe pre-check (advisory — the unique index is the real guarantee) ───
  const { data: existing } = await supabase
    .from('shop_review_requests')
    .select('id, token, status')
    .eq('job_id', jobId)
    .maybeSingle<Pick<ShopReviewRequest, 'id' | 'token' | 'status'>>()

  if (existing) {
    return result('already_enqueued', 'A review request was already queued for this job.', {
      requestId: existing.id,
      token: existing.token,
    })
  }

  // ── Insert ────────────────────────────────────────────────────────────────
  const token = newToken()
  const { data: inserted, error: insertError } = await supabase
    .from('shop_review_requests')
    .insert({
      shop_id:       shopId,
      job_id:        jobId,
      customer_id:   customer.id,
      phone,
      status:        'pending',
      send_attempts: 0,
      token,
    })
    .select('id, token')
    .maybeSingle<Pick<ShopReviewRequest, 'id' | 'token'>>()

  if (insertError) {
    // 23505 is the unique index on job_id firing — a concurrent enqueue won the
    // race. That is the system working, not an error worth surfacing as one.
    if (insertError.code === '23505') {
      return result('already_enqueued', 'A review request was already queued for this job.')
    }
    return result(
      isMissingSchema(insertError) ? 'schema_missing' : 'insert_failed',
      isMissingSchema(insertError)
        ? 'Review requests are not set up on this database yet.'
        : `Could not queue the review request: ${insertError.message}`,
    )
  }
  if (!inserted) {
    return result('insert_failed', 'Could not queue the review request.')
  }

  return result('enqueued', 'Review request queued.', {
    requestId: inserted.id,
    token: inserted.token ?? token,
  })
}

/**
 * Writes a terminal `skipped` row. Best effort: if this fails the caller still
 * gets its reason back, it just does not appear on the dashboard.
 */
async function recordSkip(
  supabase: SupabaseClient,
  shopId: string,
  job: JobFields,
  customerId: string,
  phone: string | null,
  reason: string,
): Promise<boolean> {
  try {
    const { error } = await supabase.from('shop_review_requests').insert({
      shop_id:           shopId,
      job_id:            job.id,
      customer_id:       customerId,
      phone,
      status:            'skipped',
      send_attempts:     0,
      send_attempted_at: new Date().toISOString(),
      token:             newToken(),
      error:             reason,
    })
    return !error
  } catch {
    return false
  }
}

/** The text the template picker reads: what the shop wrote on the job. */
export function jobServiceText(
  job: Pick<ShopJob, 'description' | 'complaint'> | null,
): string {
  return [job?.description, job?.complaint].filter(Boolean).join(' ').trim()
}

// GET   /api/shop/jobs/[id]/invoice  - the invoice view for a job.
// POST  /api/shop/jobs/[id]/invoice  - ONE-CLICK CONVERT: work order -> invoice.
// PATCH /api/shop/jobs/[id]/invoice  - mark paid / unpaid.
//
// WHY THIS ENDPOINT EXISTS AT ALL
// The HD Suite had no server-side convert. Its "create invoice" was a link to
// `/hd/invoices/new?...` carrying ~18 query parameters that the new-invoice page
// read back out of `window.location.search` — so the conversion was a URL the
// customer's browser could rewrite, it could not be called by anything but that
// one button, and it silently dropped every part line because the page rebuilt
// the invoice from `labor_hours * labor_rate` alone. This route is the real
// thing: one authenticated POST, the whole conversion server-side.
//
// PARTS CARRY THROUGH. In this schema the invoice IS the job, and its money is
// the `shop_job_line_items` rows the techs already wrote — so conversion never
// copies line items into a second table and therefore cannot lose one. The
// endpoint refuses to convert a job with no line items rather than inventing a
// labor line to stand in for them.
//
// ROLE: `viewAllJobs` (manager / foreman). A tech may not invoice.

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  apiError,
  asBoolean,
  canAdvance,
  jobPatchForStatus,
  loadJobDetail,
  readJsonBody,
} from '@/lib/shop/jobs'
import {
  buildInvoice,
  canInvoice,
  invoiceFieldsOf,
  isMissingColumnError,
  isUniqueViolation,
  newPublicToken,
  nextInvoiceNumber,
  type InvoiceView,
} from '@/lib/shop/invoice'
import type { ShopJob } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Retries for the unique index on (shop_id, invoice_number). Five is generous:
 * each retry only loses to another conversion that committed in between, so the
 * loop advances by at least one number every attempt.
 */
const MAX_MINT_ATTEMPTS = 5

/** Columns the invoice feature owns on shop_jobs. */
type InvoicePatch = Record<string, string | null>

interface MintResult {
  job:      ShopJob | null
  /** True when migration 009+ has not been applied — status moved, number did not. */
  degraded: boolean
  error:    string | null
}

/**
 * Writes the status advance and the invoice identity in one statement.
 *
 * NUMBERING RACE SAFETY — the DB unique index on (shop_id, invoice_number) is
 * the guarantee, and this loop is the allocator built on it. See the long note
 * in `lib/shop/invoice.ts` for why an advisory lock was rejected: PostgREST
 * autocommits every call, so a lock taken in one round-trip is gone before the
 * next, and the SECURITY DEFINER function that would fix that lives in
 * `supabase/**`, which this feature does not own.
 *
 * Two guards make the loop correct:
 *   - `.is('invoice_number', null)` makes the mint a COMPARE-AND-SET, so a
 *     second conversion cannot overwrite a number that already went out on an
 *     invoice. Zero rows updated means we lost the race, not that it failed.
 *   - a 23505 means someone took OUR number between the read and the write, so
 *     we re-read the maximum and try the next one.
 */
async function mintInvoice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  shopId: string,
  jobId: string,
  statusPatch: InvoicePatch,
  existingNumber: string | null,
  existingToken: string | null,
): Promise<MintResult> {
  // The token is minted once and never rotated: re-sending an invoice must not
  // break a link the customer already has open in a text message.
  const token = existingToken ?? newPublicToken()

  for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt += 1) {
    const number = existingNumber ?? (await nextInvoiceNumber(supabase, shopId))

    const patch: InvoicePatch = {
      ...statusPatch,
      invoice_number:       number,
      invoice_public_token: token,
    }

    let query = supabase
      .from('shop_jobs')
      .update(patch)
      .eq('id', jobId)
      .eq('shop_id', shopId)

    // Only guard when we are minting fresh. Regenerating an existing invoice
    // rewrites its own number, which is a no-op.
    if (!existingNumber) query = query.is('invoice_number', null)

    const { data, error } = await query.select('*').maybeSingle<ShopJob>()

    if (error) {
      if (isMissingColumnError(error)) return applyStatusOnly(supabase, shopId, jobId, statusPatch)
      if (isUniqueViolation(error)) continue
      return { job: null, degraded: false, error: error.message }
    }

    if (data) return { job: data, degraded: false, error: null }

    // Zero rows: another conversion minted first. Its number is the live one.
    const { data: raced } = await supabase
      .from('shop_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('shop_id', shopId)
      .maybeSingle<ShopJob>()

    if (raced && invoiceFieldsOf(raced).invoice_number) {
      return { job: raced, degraded: false, error: null }
    }
    // The guard matched nothing and no number is there either - the row moved
    // out from under us (voided, reassigned). Stop rather than loop.
    return { job: null, degraded: false, error: 'The job changed while it was being invoiced.' }
  }

  return { job: null, degraded: false, error: 'Could not allocate an invoice number. Try again.' }
}

/**
 * Fallback for a database where migration 009+ has not landed. The job still
 * advances to `invoiced` — the board must keep working — but there is no number
 * and no public link, and the caller is told so rather than shown a blank one.
 */
async function applyStatusOnly(
  supabase: Awaited<ReturnType<typeof createClient>>,
  shopId: string,
  jobId: string,
  statusPatch: InvoicePatch,
): Promise<MintResult> {
  if (Object.keys(statusPatch).length === 0) {
    const { data } = await supabase
      .from('shop_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('shop_id', shopId)
      .maybeSingle<ShopJob>()
    return { job: data ?? null, degraded: true, error: null }
  }

  const { data, error } = await supabase
    .from('shop_jobs')
    .update(statusPatch)
    .eq('id', jobId)
    .eq('shop_id', shopId)
    .select('*')
    .maybeSingle<ShopJob>()

  if (error || !data) {
    return { job: null, degraded: true, error: error?.message ?? 'Could not update the job.' }
  }
  return { job: data, degraded: true, error: null }
}

/** Loads everything `buildInvoice` needs, or null when the job is out of reach. */
async function loadView(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  ctx: NonNullable<Awaited<ReturnType<typeof apiContext>>['ctx']>,
  jobOverride?: ShopJob,
): Promise<{ view: InvoiceView; job: ShopJob } | null> {
  const detail = await loadJobDetail(supabase, jobId, { shopId: ctx.shop.id, techId: null })
  if (!detail) return null

  const job = jobOverride ?? detail.job
  return {
    job,
    view: buildInvoice(
      job,
      detail.lineItems,
      detail.customer,
      detail.vehicle,
      ctx.shop,
      ctx.permissions.viewMargins,
    ),
  }
}

// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext('viewAllJobs')
  if (error) return error

  const { id } = await params
  const supabase = await createClient()
  const loaded = await loadView(supabase, id, ctx)
  if (!loaded) return apiError('Job not found.', 404)

  return Response.json({
    invoice: loaded.view,
    canInvoice: canInvoice(loaded.job),
  })
}

export async function POST(_req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext('viewAllJobs')
  if (error) return error

  const { id } = await params
  const supabase = await createClient()

  const detail = await loadJobDetail(supabase, id, { shopId: ctx.shop.id, techId: null })
  if (!detail) return apiError('Job not found.', 404)

  const { job } = detail

  // Refuses a voided job, and refuses anything that is not `completed` (the real
  // conversion) or already `invoiced` (regeneration, which must stay idempotent).
  const gate = canInvoice(job)
  if (!gate.ok) return apiError(gate.reason ?? 'This job cannot be invoiced.', 409)

  // The defect this whole endpoint exists to avoid: an invoice with no line
  // items is a conversion that lost them. Refuse loudly instead of billing a
  // synthesized labor line.
  if (detail.lineItems.length === 0) {
    return apiError('Add labor or parts to this job before invoicing it.', 409)
  }

  const fields = invoiceFieldsOf(job)
  const now = new Date().toISOString()

  // The status write goes through the SAME helpers the board's advance button
  // uses, so `invoiced_at` is stamped identically and the bay side effect stays
  // whatever `bayEffectForStatus` says it is (for `invoiced`: none — the bay was
  // already freed at `completed`).
  const statusPatch: InvoicePatch = {}
  if (job.status === 'completed') {
    const check = canAdvance(job)
    if (!check.ok || check.next !== 'invoiced') {
      return apiError(check.reason ?? 'This job cannot be invoiced yet.', 409)
    }
    Object.assign(statusPatch, jobPatchForStatus('invoiced', now))
  }

  // IDEMPOTENT: a job that already carries both a number and a token, and is
  // already `invoiced`, needs no write at all — a second click must not mint a
  // second number.
  const alreadyMinted = !!fields.invoice_number && !!fields.invoice_public_token
  if (alreadyMinted && Object.keys(statusPatch).length === 0) {
    const loaded = await loadView(supabase, id, ctx)
    if (!loaded) return apiError('Job not found.', 404)
    return Response.json({ invoice: loaded.view, created: false, degraded: false })
  }

  const minted = await mintInvoice(
    supabase,
    ctx.shop.id,
    job.id,
    statusPatch,
    fields.invoice_number,
    fields.invoice_public_token,
  )
  if (minted.error || !minted.job) {
    return apiError(minted.error ?? 'Could not create the invoice.', 400)
  }

  const loaded = await loadView(supabase, id, ctx, minted.job)
  if (!loaded) return apiError('Job not found.', 404)

  return Response.json({
    invoice:  loaded.view,
    created:  !alreadyMinted,
    degraded: minted.degraded,
    warning:  minted.degraded
      ? 'The job is marked invoiced, but invoice numbering is unavailable until the invoice columns migration is applied.'
      : null,
  })
}

/** `{ paid: true | false }` — stamps or clears `paid_at`. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext('viewAllJobs')
  if (error) return error

  const { id } = await params
  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const paid = asBoolean(body.paid)
  if (paid === null) return apiError('Expected { paid: true | false }.', 400)

  const supabase = await createClient()

  const { data: job } = await supabase
    .from('shop_jobs')
    .select('*')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<ShopJob>()

  if (!job) return apiError('Job not found.', 404)
  if (job.voided) return apiError('This job has been voided.', 409)
  if (job.status !== 'invoiced') return apiError('Invoice this job before marking it paid.', 409)

  const { error: writeError } = await supabase
    .from('shop_jobs')
    .update({ paid_at: paid ? new Date().toISOString() : null })
    .eq('id', job.id)
    .eq('shop_id', ctx.shop.id)

  if (writeError) {
    if (isMissingColumnError(writeError)) {
      return apiError(
        'Payment tracking is unavailable until the invoice columns migration is applied.',
        503,
      )
    }
    return apiError(writeError.message, 400)
  }

  const loaded = await loadView(supabase, id, ctx)
  if (!loaded) return apiError('Job not found.', 404)

  return Response.json({ invoice: loaded.view })
}

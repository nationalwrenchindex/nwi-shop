// POST /api/shop/jobs/[id]/invoice/send - deliver the invoice to the customer.
//
// Email carries the invoice summary and a link; SMS carries the link alone. Both
// point at `/i/{token}`, the login-free public view.
//
// NOTHING HERE THROWS ON A DELIVERY FAILURE. `@/lib/email` and `@/lib/twilio`
// both swallow their own errors by contract, and this route reports per-channel
// outcomes in the response instead of failing the request: a customer's mailbox
// bouncing must not undo the send stamp or leave the manager staring at a 500.
// The one thing that IS an error is having no channel to send on at all.
//
// SUPPRESSION IS ABSOLUTE. `shop_customers.no_email` / `no_sms` are honoured even
// on a deliberate manual send — the flag is the customer's instruction, not a
// default the shop can click past.
//
// ROLE: `viewAllJobs` (manager / foreman).

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, asBoolean, asText, loadJobDetail } from '@/lib/shop/jobs'
import {
  asInvoicedJob,
  buildInvoice,
  invoiceEmailBody,
  invoiceLabel,
  invoiceFieldsOf,
  invoiceSmsBody,
  isMissingColumnError,
  newPublicToken,
  publicInvoiceUrl,
  type InvoicedJob,
} from '@/lib/shop/invoice'
import { sendShopEmail } from '@/lib/email'
import { sendShopSmsResult } from '@/lib/twilio'
import type { ShopJob } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

interface ChannelResult {
  attempted: boolean
  sent:      boolean
  to:        string | null
  /** Why it did not go out. Null on success. */
  reason:    string | null
}

const skipped = (reason: string): ChannelResult => ({
  attempted: false,
  sent: false,
  to: null,
  reason,
})

/**
 * Returns the job's public token, minting one if it has none.
 *
 * `.is('invoice_public_token', null)` makes this a compare-and-set: two sends
 * firing at once would otherwise both generate a token and the second would
 * overwrite the first, silently killing a link that had already gone out over
 * SMS. Returns null when the invoice columns do not exist yet.
 */
async function ensureToken(
  supabase: Awaited<ReturnType<typeof createClient>>,
  shopId: string,
  job: ShopJob,
): Promise<string | null> {
  const existing = invoiceFieldsOf(job).invoice_public_token
  if (existing) return existing

  const token = newPublicToken()
  const { data, error } = await supabase
    .from('shop_jobs')
    .update({ invoice_public_token: token })
    .eq('id', job.id)
    .eq('shop_id', shopId)
    .is('invoice_public_token', null)
    .select('*')
    .maybeSingle<ShopJob>()

  if (error) {
    if (isMissingColumnError(error)) return null
    return null
  }
  if (data) return invoiceFieldsOf(data).invoice_public_token

  // Lost the race - re-read and use whatever token actually landed.
  const { data: raced } = await supabase
    .from('shop_jobs')
    .select('*')
    .eq('id', job.id)
    .eq('shop_id', shopId)
    .maybeSingle<ShopJob>()

  return raced ? invoiceFieldsOf(raced).invoice_public_token : null
}

export async function POST(req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext('viewAllJobs')
  if (error) return error

  const { id } = await params

  // Body is optional: an empty POST sends on every channel the customer allows.
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await req.json()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>
    }
  } catch {
    body = {}
  }

  const wantEmail = asBoolean(body.email) ?? true
  const wantSms = asBoolean(body.sms) ?? true
  const overrideEmail = asText(body.to)
  const overridePhone = asText(body.phone)

  const supabase = await createClient()
  const detail = await loadJobDetail(supabase, id, { shopId: ctx.shop.id, techId: null })
  if (!detail) return apiError('Job not found.', 404)

  const { job, customer } = detail
  if (job.voided) return apiError('This job has been voided.', 409)
  if (job.status !== 'invoiced') {
    return apiError('Create the invoice before sending it.', 409)
  }
  if (!wantEmail && !wantSms) return apiError('Pick at least one channel to send on.', 400)

  // Mint before sending. The token belongs to the invoice, not to the send, so a
  // failed delivery still leaves a working link the manager can copy by hand.
  const token = await ensureToken(supabase, ctx.shop.id, job)
  const publicUrl = token ? publicInvoiceUrl(token) : null

  // The freshly minted token has to be on the row the view is built from, or the
  // very first send would deliver a link-less invoice.
  const jobForView: InvoicedJob = { ...asInvoicedJob(job), invoice_public_token: token }

  const view = buildInvoice(
    jobForView,
    detail.lineItems,
    customer,
    detail.vehicle,
    ctx.shop,
    false,
  )

  // ---- email --------------------------------------------------------------
  let email: ChannelResult
  if (!wantEmail) {
    email = skipped('Not requested.')
  } else if (customer?.no_email) {
    email = skipped('This customer is marked do-not-email.')
  } else {
    const to = overrideEmail ?? customer?.email ?? null
    if (!to) {
      email = skipped('No email address on file.')
    } else {
      const ok = await sendShopEmail({
        to,
        subject:  `Invoice ${invoiceLabel(view)} from ${ctx.shop.business_name}`,
        heading:  `Invoice ${invoiceLabel(view)}`,
        bodyHtml: invoiceEmailBody(view),
        ...(ctx.shop.email ? { replyTo: ctx.shop.email } : {}),
      })
      email = {
        attempted: true,
        sent:      ok,
        to,
        reason:    ok ? null : 'The email service rejected the message or is not configured.',
      }
    }
  }

  // ---- sms ----------------------------------------------------------------
  let sms: ChannelResult
  if (!wantSms) {
    sms = skipped('Not requested.')
  } else if (customer?.no_sms) {
    sms = skipped('This customer is marked do-not-text.')
  } else {
    const to = overridePhone ?? customer?.phone ?? null
    if (!to) {
      sms = skipped('No phone number on file.')
    } else {
      const result = await sendShopSmsResult({ to, body: invoiceSmsBody(view) })
      sms = {
        attempted: true,
        sent:      result.success,
        to,
        reason:    result.success ? null : result.error ?? 'The SMS service rejected the message.',
      }
    }
  }

  // ---- stamp --------------------------------------------------------------
  // Only when something actually went out. A stamp on a send where every channel
  // was suppressed would tell the shop the customer has the invoice when they do
  // not.
  let sentAt: string | null = invoiceFieldsOf(job).invoice_sent_at
  if (email.sent || sms.sent) {
    const now = new Date().toISOString()
    const { error: stampError } = await supabase
      .from('shop_jobs')
      .update({ invoice_sent_at: now })
      .eq('id', job.id)
      .eq('shop_id', ctx.shop.id)
    if (!stampError) sentAt = now
  }

  return Response.json({
    ok: email.sent || sms.sent,
    email,
    sms,
    publicUrl,
    sentAt,
    warning: token
      ? null
      : 'No public link could be created - the invoice columns migration has not been applied.',
  })
}

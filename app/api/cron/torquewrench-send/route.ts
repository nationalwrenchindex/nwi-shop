// GET /api/cron/torquewrench-send
//
// The review-request sender. Runs on a schedule (every 5 minutes is what the
// Suite used) and is the ONLY thing that texts a customer for TorqueWrench.
// Enqueue writes a pending row; this decides when it actually goes out.
//
// Public in the routing sense — /api/cron is not under proxy.ts's protected
// prefixes — and gated entirely by authorizeCron, which fails closed when
// CRON_SECRET is unset. Uses the service client because there is no session.
//
//   curl -H 'x-cron-secret: <CRON_SECRET>' https://<host>/api/cron/torquewrench-send
//
// Every table read here may not exist yet (migration 009). A missing table is
// reported as a skipped run, not a crash — a cron that 500s every five minutes
// buries the log that would tell someone why.

import { createServiceClient } from '@/lib/supabase/service'
import { sendShopSmsResult } from '@/lib/twilio'
import { buildSmsBody, firstNameOf } from '@/lib/shop/torquewrench/templates'
import { buildReviewClickUrl } from '@/lib/shop/torquewrench/review-url'
import { jobServiceText } from '@/lib/shop/torquewrench/enqueue'
import { DEFAULT_DELAY_MINUTES, type ShopReviewRequest, type ShopReviewSettings } from '@/lib/shop/torquewrench/types'
import type { ShopCustomer, ShopJob, ShopProfile } from '@/lib/types'
import { authorizeCron } from '../_auth'

export const dynamic = 'force-dynamic'

/** Three tries, then the row is parked as `failed` and never retried. */
const MAX_ATTEMPTS = 3

/** How many requests one invocation will work through. */
const BATCH_LIMIT = 100

type JobFields = Pick<ShopJob, 'id' | 'completed_at' | 'description' | 'complaint'>
type CustomerFields = Pick<ShopCustomer, 'id' | 'first_name' | 'company' | 'no_sms'>
type ShopFields = Pick<ShopProfile, 'id' | 'business_name'>

export async function GET(request: Request) {
  const denied = authorizeCron(request)
  if (denied) return denied

  const supabase = createServiceClient()
  const now = Date.now()

  // Only rows never attempted. A row that has been attempted and failed keeps
  // send_attempted_at null (see the failure branch below) so it comes back
  // round; the null filter is what stops a delivered text being sent twice.
  const { data: requests, error } = await supabase
    .from('shop_review_requests')
    .select('*')
    .eq('status', 'pending')
    .is('send_attempted_at', null)
    .lt('send_attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT)
    .returns<ShopReviewRequest[]>()

  if (error) {
    console.error('[tw-cron] could not read shop_review_requests:', error.message)
    return Response.json(
      { error: error.message, processed: 0, sent: 0, skipped: 0, failed: 0 },
      { status: 500 },
    )
  }

  if (!requests || requests.length === 0) {
    return Response.json({ processed: 0, sent: 0, skipped: 0, failed: 0 })
  }

  const shopIds = [...new Set(requests.map((r) => r.shop_id))]
  const jobIds = [...new Set(requests.map((r) => r.job_id).filter(Boolean))]
  const customerIds = [
    ...new Set(requests.map((r) => r.customer_id).filter((v): v is string => !!v)),
  ]

  const [settingsList, shops, jobs, customers] = await Promise.all([
    rows<ShopReviewSettings>(() =>
      supabase
        .from('shop_review_settings')
        .select('*')
        .in('shop_id', shopIds)
        .returns<ShopReviewSettings[]>(),
    ),
    rows<ShopFields>(() =>
      supabase
        .from('shop_profiles')
        .select('id, business_name')
        .in('id', shopIds)
        .returns<ShopFields[]>(),
    ),
    rows<JobFields>(() =>
      supabase
        .from('shop_jobs')
        .select('id, completed_at, description, complaint')
        .in('id', jobIds)
        .returns<JobFields[]>(),
    ),
    customerIds.length
      ? rows<CustomerFields>(() =>
          supabase
            .from('shop_customers')
            .select('id, first_name, company, no_sms')
            .in('id', customerIds)
            .returns<CustomerFields[]>(),
        )
      : Promise.resolve<CustomerFields[]>([]),
  ])

  const settingsByShop = new Map(settingsList.map((s) => [s.shop_id, s]))
  const shopById = new Map(shops.map((s) => [s.id, s]))
  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const customerById = new Map(customers.map((c) => [c.id, c]))

  let sent = 0
  let skipped = 0
  let failed = 0
  let waiting = 0

  for (const req of requests) {
    const settings = settingsByShop.get(req.shop_id)

    // Feature switched off, or the place id was cleared after the row was
    // queued. Left pending on purpose: turning it back on should send it.
    if (!settings?.is_enabled || !settings.google_place_id) {
      skipped++
      continue
    }

    // ── The delay clock runs from job completion, not from enqueue ──────────
    // Those are usually the same instant, but a request queued by hand from the
    // dashboard days later must not restart the customer's clock.
    const job = jobById.get(req.job_id) ?? null
    const anchor = job?.completed_at ?? req.created_at
    const delayMs = (settings.delay_minutes ?? DEFAULT_DELAY_MINUTES) * 60_000
    const anchorMs = Date.parse(anchor)
    if (Number.isFinite(anchorMs) && anchorMs + delayMs > now) {
      waiting++
      continue
    }

    if (!req.phone) {
      await park(supabase, req.id, 'no phone on the request')
      skipped++
      continue
    }

    // Opt-out is re-checked at send time, not just at enqueue: a customer can
    // ask to stop between the job closing and the delay elapsing, and this is
    // the last gate before a message actually leaves. Parked as `skipped` so the
    // cron does not reconsider it every five minutes forever.
    const customer = req.customer_id ? customerById.get(req.customer_id) ?? null : null
    if (customer?.no_sms) {
      await park(supabase, req.id, 'customer opted out of SMS')
      skipped++
      continue
    }

    const businessName = shopById.get(req.shop_id)?.business_name?.trim() || 'our shop'
    const body = buildSmsBody({
      serviceText:    jobServiceText(job),
      customTemplate: settings.message_template,
      vars: {
        customerFirstName: firstNameOf(customer),
        businessName,
        reviewLink:        buildReviewClickUrl(req.token),
      },
    })

    const outcome = await sendShopSmsResult({ to: req.phone, body })
    const attempts = (req.send_attempts ?? 0) + 1
    const stamp = new Date().toISOString()

    if (outcome.success) {
      await update(supabase, req.id, {
        status:            'sent',
        send_attempted_at: stamp,
        sent_at:           stamp,
        send_attempts:     attempts,
        error:             null,
      })
      sent++
      continue
    }

    if (attempts >= MAX_ATTEMPTS) {
      await update(supabase, req.id, {
        status:            'failed',
        send_attempted_at: stamp,
        send_attempts:     attempts,
        error:             outcome.error ?? 'send failed',
      })
      failed++
    } else {
      // send_attempted_at stays null so the next run picks this row up again.
      await update(supabase, req.id, {
        send_attempts: attempts,
        error:         outcome.error ?? 'send failed',
      })
      failed++
    }
    console.error(
      `[tw-cron] send failed for ${req.id} (attempt ${attempts}/${MAX_ATTEMPTS}): ${outcome.error}`,
    )
  }

  console.log(
    `[tw-cron] processed=${requests.length} sent=${sent} skipped=${skipped} ` +
    `failed=${failed} waiting=${waiting}`,
  )
  return Response.json({ processed: requests.length, sent, skipped, failed, waiting })
}

type RequestPatch = Partial<
  Pick<
    ShopReviewRequest,
    'status' | 'send_attempted_at' | 'sent_at' | 'send_attempts' | 'error'
  >
>

async function update(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
  patch: RequestPatch,
): Promise<void> {
  const { error } = await supabase.from('shop_review_requests').update(patch).eq('id', id)
  if (error) console.error(`[tw-cron] could not update ${id}: ${error.message}`)
}

/** Terminal skip: stamped so this row is never reconsidered. */
async function park(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
  reason: string,
): Promise<void> {
  await update(supabase, id, {
    status:            'skipped',
    send_attempted_at: new Date().toISOString(),
    error:             reason,
  })
}

async function rows<T>(run: () => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const { data } = await run()
    return data ?? []
  } catch {
    return []
  }
}

// NWI Garage sync — a ONE-WAY outbound write from NWI Shop into NWI Garage.
//
// ── WHAT NWI GARAGE IS, AND WHY THIS FILE IS CAREFUL ────────────────────────
// NWI Garage is a separate consumer product that happens to share this Supabase
// project. Its tables (`garage_profiles`, `garage_vehicles`,
// `garage_service_history`) belong to that product, not to NWI Shop. We write
// into a real person's private vehicle history, so three rules hold everywhere
// below:
//
//   1. Never write outside the documented shape. No new columns, no guessing.
//   2. Never claim success we did not get. Every refusal comes back with a
//      named outcome and a sentence the UI shows verbatim — a shop being told
//      "posted" when nothing landed is worse than being told nothing happened.
//   3. Never throw. A garage post is a bonus on top of finishing a job; it must
//      not be able to fail invoicing, job completion, or a page render.
//
// This is ported from NWI Suite's src/lib/garage/link.ts, which posted when an
// invoice was SENT. Here the unit of work is a shop job.
//
// ── THE TWO CONSTRAINTS SUITE FOUND THE HARD WAY ────────────────────────────
// Both were discovered empirically against the live Garage tables; the Garage
// product owns them and does not publish them. Violating either fails the write.
//
//   • `garage_service_history.service_type` is restricted by a CHECK constraint
//     to a fixed vocabulary. A job description like "Labor — Tire Rotation"
//     fails it with 23514. categoriseService below maps free text onto the
//     allowed list, and `service_description` carries the real wording.
//
//   • `garage_service_history.mileage_at_service` is NOT NULL. We refuse to
//     post rather than writing 0: the customer's service reminders are driven
//     off due_mileage, and a zero would corrupt their whole history.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { customerName, vehicleLabel } from '@/lib/shop/jobs'
import type {
  ShopCustomer,
  ShopJob,
  ShopJobLineItem,
  ShopProfile,
  ShopVehicle,
} from '@/lib/types'

/**
 * Where a customer without a Garage account is sent to sign up.
 *
 * NWI_GARAGE_JOIN_URL is NOT set in this project's environment today. That is
 * fine and must stay fine — the default below is the live join page, and this
 * module never throws on a missing variable.
 */
const GARAGE_JOIN_URL = (
  process.env.NWI_GARAGE_JOIN_URL || 'https://nwigarage.com/join'
).replace(/\/+$/, '')

/**
 * The CHECK constraint's vocabulary. 'electrical' is accepted by the constraint
 * too, but nothing in a shop job maps onto it reliably enough to be worth the
 * mis-file, so it is never inferred.
 */
export const GARAGE_SERVICE_TYPES = [
  'oil_change',
  'tires',
  'brakes',
  'transmission',
  'diagnostics',
  'other',
] as const

export type GarageServiceType = (typeof GARAGE_SERVICE_TYPES)[number]

export const GARAGE_SERVICE_TYPE_LABELS: Record<GarageServiceType, string> = {
  oil_change:   'Oil change',
  tires:        'Tires',
  brakes:       'Brakes',
  transmission: 'Transmission',
  diagnostics:  'Diagnostics',
  other:        'Other',
}

/**
 * First category whose keywords appear in the job text; 'other' otherwise.
 *
 * Note how coarse the target vocabulary is compared to what a shop actually
 * writes on a job. An A/C recharge, a DPF clean and a wheel bearing all land in
 * 'other' — that is not a bug, it is the Garage product's category list, and
 * forcing a closer-sounding match would misfile the record in a customer's own
 * history. The precise wording survives in `service_description`.
 */
export function categoriseService(freeText: string): GarageServiceType {
  const t = freeText.toLowerCase()
  const rules: Array<[GarageServiceType, RegExp]> = [
    ['oil_change',   /\boil\b|lube|oil change|filter change/],
    ['brakes',       /\bbrake|rotor|caliper|brake pad|slack adjuster/],
    ['tires',        /\btire|wheel|rotation|balance|tpms|alignment/],
    ['transmission', /transmission|clutch|differential|drivetrain/],
    ['diagnostics',  /diagnos|scan|check engine|fault code|inspection/],
  ]
  for (const [type, re] of rules) if (re.test(t)) return type
  return 'other'
}

export interface GarageVehicleInput {
  vin:     string | null
  year:    number | null
  make:    string | null
  model:   string | null
  mileage: number | null
}

export interface GarageSyncInput {
  shopId:        string
  jobId:         string
  customerEmail: string | null
  vehicle:       GarageVehicleInput | null
  shopName:      string
  shopPhone:     string | null
  /** What the shop wrote on the job; categorised before it reaches Garage. */
  serviceText:   string
  notes:         string | null
  cost:          number | null
  /** YYYY-MM-DD. */
  serviceDate:   string
}

export type GarageOutcome =
  | 'posted'
  | 'already_posted'
  | 'not_linked'
  | 'no_email'
  | 'no_vehicle'
  | 'no_mileage'
  | 'guard_missing'
  | 'garage_unavailable'
  | 'write_failed'

export interface GarageSyncResult {
  outcome: GarageOutcome
  /** True only when a service record actually landed in the customer's garage. */
  posted: boolean
  /** Shown to the shop verbatim. Never optimistic. */
  message: string
  /** Present whenever the customer has no Garage account to post into. */
  joinUrl: string | null
  nwiGarageId: string | null
  serviceRecordId: string | null
}

function outcome(
  kind: GarageOutcome,
  message: string,
  extra: Partial<GarageSyncResult> = {},
): GarageSyncResult {
  return {
    outcome: kind,
    posted: kind === 'posted',
    message,
    joinUrl: null,
    nwiGarageId: null,
    serviceRecordId: null,
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// Join links
// ---------------------------------------------------------------------------

/** Pre-populated signup link for a customer who has no Garage account yet. */
export function buildGarageJoinUrl(vehicle: GarageVehicleInput | null): string {
  const params = new URLSearchParams()
  if (vehicle?.vin) params.set('vin', vehicle.vin)
  if (vehicle?.year) params.set('year', String(vehicle.year))
  if (vehicle?.make) params.set('make', vehicle.make)
  if (vehicle?.model) params.set('model', vehicle.model)
  if (vehicle?.mileage) params.set('mileage', String(vehicle.mileage))
  const qs = params.toString()
  return qs ? `${GARAGE_JOIN_URL}?${qs}` : GARAGE_JOIN_URL
}

/**
 * Compact signup link for SMS: VIN only, protocol stripped.
 *
 * The full link carries five params and runs past 110 characters, which adds a
 * segment to every text. The VIN alone is enough for the join page to identify
 * the vehicle, and handsets linkify a bare domain fine.
 */
export function buildGarageJoinSmsLink(vin: string): string {
  const host = GARAGE_JOIN_URL.replace(/^https?:\/\//, '')
  return `${host}?vin=${encodeURIComponent(vin)}`
}

// ---------------------------------------------------------------------------
// Account resolution
// ---------------------------------------------------------------------------

export interface GarageAccount {
  userId: string
  nwiGarageId: string | null
}

/**
 * Resolves an email address to a Garage account, or null.
 *
 * TWO CHECKS, BOTH REQUIRED — ported exactly from the Suite:
 *
 *   1. GoTrue's admin user filter. It is a SEARCH, not an equality test, so the
 *      exact address is confirmed against the results. Using the filter rather
 *      than paginating listUsers keeps this O(1) as the user table grows.
 *
 *   2. A `garage_profiles` row for that user id. An auth user alone proves
 *      nothing: every shop tech and mechanic in this project also has an auth
 *      user, and posting to one of them would file a customer's repair in a
 *      stranger's garage.
 */
export async function findGarageUser(email: string): Promise<GarageAccount | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return null

  const normalized = email.trim().toLowerCase()
  if (!normalized) return null

  let userId: string | null = null
  try {
    const res = await fetch(
      `${base}/auth/v1/admin/users?filter=${encodeURIComponent(normalized)}`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!res.ok) return null
    const json = (await res.json()) as { users?: Array<{ id: string; email?: string }> }
    const hit = (json.users ?? []).find((u) => u.email?.toLowerCase() === normalized)
    userId = hit?.id ?? null
  } catch {
    return null
  }
  if (!userId) return null

  try {
    const { data } = await createServiceClient()
      .from('garage_profiles')
      .select('user_id, nwi_garage_id')
      .eq('user_id', userId)
      .maybeSingle<{ user_id: string; nwi_garage_id: string | null }>()

    if (!data) return null
    return { userId, nwiGarageId: data.nwi_garage_id ?? null }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Vehicle upsert
// ---------------------------------------------------------------------------

interface GarageVehicleRow {
  id: string
  mileage: number | null
}

/**
 * Finds the customer's garage vehicle, creating it from the job when the VIN is
 * not already there — the whole point is that the customer does nothing.
 *
 * VIN is the match key when present. Without one, year+make+model is the best
 * available, scoped to this user so a collision only ever merges two of their
 * own identical vehicles.
 */
async function findOrCreateGarageVehicle(
  userId: string,
  vehicle: GarageVehicleInput,
): Promise<{ row: GarageVehicleRow; failed: false } | { row: null; failed: true; message: string }> {
  const svc = createServiceClient()

  try {
    let query = svc.from('garage_vehicles').select('id, mileage').eq('user_id', userId)
    query = vehicle.vin
      ? query.eq('vin', vehicle.vin)
      : query.eq('year', vehicle.year).eq('make', vehicle.make).eq('model', vehicle.model)

    const { data: existing, error: readError } = await query
      .limit(1)
      .maybeSingle<GarageVehicleRow>()

    if (readError) {
      return { row: null, failed: true, message: readError.message }
    }
    if (existing) {
      return { row: { id: existing.id, mileage: existing.mileage ?? null }, failed: false }
    }

    const { data: inserted, error } = await svc
      .from('garage_vehicles')
      .insert({
        user_id: userId,
        vin:     vehicle.vin,
        year:    vehicle.year,
        make:    vehicle.make,
        model:   vehicle.model,
        mileage: vehicle.mileage,
        ...(vehicle.mileage ? { mileage_updated_at: new Date().toISOString() } : {}),
      })
      .select('id')
      .maybeSingle<{ id: string }>()

    if (error || !inserted) {
      return {
        row: null,
        failed: true,
        message: error?.message ?? 'the vehicle could not be created',
      }
    }
    return { row: { id: inserted.id, mileage: vehicle.mileage }, failed: false }
  } catch (err) {
    return {
      row: null,
      failed: true,
      message: err instanceof Error ? err.message : 'the vehicle lookup failed',
    }
  }
}

// ---------------------------------------------------------------------------
// The sync
// ---------------------------------------------------------------------------

/** The job columns migration 009 adds. Read defensively — it may not be applied. */
interface JobGuardRow {
  id: string
  garage_posted_at: string | null
  garage_service_record_id: string | null
}

/**
 * Posts one completed/invoiced job into the customer's NWI Garage.
 *
 * Idempotent on `shop_jobs.garage_posted_at`, which is stamped only AFTER the
 * Garage write succeeds — a failure therefore retries on the next attempt
 * rather than being silently marked done. If that guard column is missing we
 * refuse outright: `garage_service_history` carries no job reference, so a
 * duplicate could never be found and removed afterwards.
 */
export async function syncJobToGarage(input: GarageSyncInput): Promise<GarageSyncResult> {
  const joinUrl = buildGarageJoinUrl(input.vehicle)
  const svc = createServiceClient()

  // ── Idempotency guard, before anything is looked up ──────────────────────
  let guard: JobGuardRow | null
  try {
    const { data, error } = await svc
      .from('shop_jobs')
      .select('id, garage_posted_at, garage_service_record_id')
      .eq('id', input.jobId)
      .eq('shop_id', input.shopId)
      .maybeSingle<JobGuardRow>()

    if (error) {
      console.error(`[garage] no idempotency guard for job ${input.jobId}: ${error.message}`)
      return outcome(
        'guard_missing',
        'This database does not have the NWI Garage tracking columns yet ' +
        '(shop_jobs.garage_posted_at). Posting without them could duplicate the ' +
        'record in the customer garage, so nothing was sent.',
        { joinUrl },
      )
    }
    guard = data
  } catch (err) {
    return outcome(
      'guard_missing',
      `Could not read the job before posting: ${err instanceof Error ? err.message : 'unknown error'}`,
      { joinUrl },
    )
  }

  if (!guard) {
    return outcome('write_failed', 'That job does not exist in this shop.', { joinUrl })
  }
  if (guard.garage_posted_at) {
    return outcome('already_posted', 'This job was already posted to NWI Garage.', {
      serviceRecordId: guard.garage_service_record_id,
    })
  }

  // ── Does the customer have a Garage? ─────────────────────────────────────
  if (!input.customerEmail) {
    return outcome(
      'no_email',
      'This customer has no email address on file, so their NWI Garage cannot be looked up. ' +
      'Send them the join link instead.',
      { joinUrl },
    )
  }

  const account = await findGarageUser(input.customerEmail)
  if (!account) {
    return outcome(
      'not_linked',
      'This customer does not have an NWI Garage yet. Send them the join link — ' +
      'their vehicle details are already filled in.',
      { joinUrl },
    )
  }

  // From here the account is real, so every refusal names the account and never
  // pitches a signup link for something they already have.
  if (!input.vehicle) {
    return outcome('no_vehicle', 'This job has no vehicle attached, so there is nothing to file.', {
      nwiGarageId: account.nwiGarageId,
    })
  }

  const vehicleResult = await findOrCreateGarageVehicle(account.userId, input.vehicle)
  if (vehicleResult.failed) {
    return outcome(
      'garage_unavailable',
      `The NWI Garage vehicle record could not be read or created: ${vehicleResult.message}`,
      { nwiGarageId: account.nwiGarageId },
    )
  }

  // mileage_at_service is NOT NULL. A job whose vehicle has no odometer reading
  // falls back to whatever the garage already knows; posting a 0 would corrupt
  // the customer's mileage history and the service reminders driven off it.
  const mileage = input.vehicle.mileage ?? vehicleResult.row.mileage
  if (mileage == null) {
    return outcome(
      'no_mileage',
      'NWI Garage requires an odometer reading on every service record. ' +
      'Add the mileage to the vehicle and post again.',
      { nwiGarageId: account.nwiGarageId },
    )
  }

  let recordId: string
  try {
    const { data: record, error } = await svc
      .from('garage_service_history')
      .insert({
        vehicle_id:          vehicleResult.row.id,
        user_id:             account.userId,
        service_date:        input.serviceDate,
        mileage_at_service:  mileage,
        // Constrained vocabulary — see categoriseService and the header note.
        service_type:        categoriseService(input.serviceText),
        // The real wording, which service_type cannot carry.
        service_description: input.serviceText || 'Service',
        notes:               input.notes,
        mechanic_name:       input.shopName,
        mechanic_phone:      input.shopPhone,
        logged_by_mechanic:  true,
        cost:                input.cost,
      })
      .select('id')
      .maybeSingle<{ id: string }>()

    if (error || !record) {
      console.error('[garage] service history insert failed:', error?.message)
      return outcome(
        'write_failed',
        `NWI Garage rejected the service record: ${error?.message ?? 'no row returned'}`,
        { nwiGarageId: account.nwiGarageId },
      )
    }
    recordId = record.id
  } catch (err) {
    return outcome(
      'garage_unavailable',
      `Could not reach NWI Garage: ${err instanceof Error ? err.message : 'unknown error'}`,
      { nwiGarageId: account.nwiGarageId },
    )
  }

  // Stamped only after the Garage write landed.
  const { error: stampError } = await svc
    .from('shop_jobs')
    .update({
      garage_posted_at: new Date().toISOString(),
      garage_service_record_id: recordId,
    })
    .eq('id', input.jobId)
    .eq('shop_id', input.shopId)

  if (stampError) {
    // The record exists in their garage; we just lost the guard. Say so loudly —
    // the next post would otherwise duplicate it.
    console.error(
      `[garage] POSTED ${recordId} but could not stamp job ${input.jobId}: ${stampError.message}`,
    )
  }

  // Keep the garage odometer current when this service reports a higher one.
  if (input.vehicle.mileage) {
    await svc
      .from('garage_vehicles')
      .update({
        mileage: input.vehicle.mileage,
        mileage_updated_at: new Date().toISOString(),
      })
      .eq('id', vehicleResult.row.id)
      .lt('mileage', input.vehicle.mileage)
  }

  return outcome(
    'posted',
    stampError
      ? 'Posted to NWI Garage, but this job could not be marked as posted — ' +
        'do not post it again or the customer will see it twice.'
      : 'Posted to the customer NWI Garage.',
    { nwiGarageId: account.nwiGarageId, serviceRecordId: recordId },
  )
}

// ---------------------------------------------------------------------------
// Loading a job's sync input, and the dashboard list
// ---------------------------------------------------------------------------

/** shop_jobs plus the two columns migration 009 adds. */
type JobWithGarage = ShopJob & Partial<Pick<JobGuardRow, 'garage_posted_at' | 'garage_service_record_id'>>

function serviceDateOf(job: Pick<ShopJob, 'invoiced_at' | 'completed_at' | 'created_at'>): string {
  const source = job.invoiced_at ?? job.completed_at ?? job.created_at
  const parsed = Date.parse(source)
  const date = Number.isFinite(parsed) ? new Date(parsed) : new Date()
  return date.toISOString().slice(0, 10)
}

function serviceTextOf(
  job: Pick<ShopJob, 'description' | 'complaint'>,
  lineItems: Pick<ShopJobLineItem, 'description'>[],
): string {
  const fromJob = [job.description, job.complaint].filter(Boolean).join(' — ').trim()
  if (fromJob) return fromJob
  // A job closed with no write-up still has its line items, and "Front brake
  // pads and rotors" categorises far better than an empty string.
  return lineItems.map((li) => li.description).filter(Boolean).join(', ').slice(0, 400)
}

/**
 * Assembles everything syncJobToGarage needs for one job. Returns null when the
 * job is not in this shop. Never throws.
 */
export async function loadGarageSyncInput(
  supabase: SupabaseClient,
  shop: Pick<ShopProfile, 'id' | 'business_name' | 'phone'>,
  jobId: string,
): Promise<GarageSyncInput | null> {
  const { data: job } = await supabase
    .from('shop_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('shop_id', shop.id)
    .maybeSingle<JobWithGarage>()

  if (!job) return null

  const [customer, vehicle, lineItems] = await Promise.all([
    job.customer_id
      ? one<Pick<ShopCustomer, 'id' | 'email' | 'no_email'>>(() =>
          supabase
            .from('shop_customers')
            .select('id, email, no_email')
            .eq('id', job.customer_id as string)
            .eq('shop_id', shop.id)
            .maybeSingle<Pick<ShopCustomer, 'id' | 'email' | 'no_email'>>(),
        )
      : Promise.resolve(null),
    job.vehicle_id
      ? one<Pick<ShopVehicle, 'vin' | 'year' | 'make' | 'model' | 'mileage'>>(() =>
          supabase
            .from('shop_vehicles')
            .select('vin, year, make, model, mileage')
            .eq('id', job.vehicle_id as string)
            .eq('shop_id', shop.id)
            .maybeSingle<Pick<ShopVehicle, 'vin' | 'year' | 'make' | 'model' | 'mileage'>>(),
        )
      : Promise.resolve(null),
    many<Pick<ShopJobLineItem, 'description' | 'total'>>(() =>
      supabase
        .from('shop_job_line_items')
        .select('description, total')
        .eq('job_id', jobId)
        .eq('shop_id', shop.id)
        .returns<Pick<ShopJobLineItem, 'description' | 'total'>[]>(),
    ),
  ])

  const cost = lineItems.reduce((sum, li) => sum + (Number(li.total) || 0), 0)

  return {
    shopId:        shop.id,
    jobId:         job.id,
    // no_email is a contact preference about US emailing THEM. It has no bearing
    // on filing a record in an account they already own, so it is not consulted.
    customerEmail: customer?.email?.trim() || null,
    vehicle: vehicle
      ? {
          vin:     vehicle.vin,
          year:    vehicle.year,
          make:    vehicle.make,
          model:   vehicle.model,
          mileage: vehicle.mileage,
        }
      : null,
    shopName:    shop.business_name,
    shopPhone:   shop.phone,
    serviceText: serviceTextOf(job, lineItems),
    notes:       job.notes,
    cost:        cost > 0 ? Math.round(cost * 100) / 100 : null,
    serviceDate: serviceDateOf(job),
  }
}

/** One row on the Garage Sync page. */
export interface GarageJobRow {
  jobId:         string
  jobNumber:     number
  status:        ShopJob['status']
  customerName:  string
  customerEmail: string | null
  vehicleLabel:  string
  vin:           string | null
  mileage:       number | null
  invoicedAt:    string | null
  completedAt:   string | null
  postedAt:      string | null
  /** Prefilled signup link, for a customer with no Garage yet. */
  joinUrl:       string
  /** False when the vehicle has no odometer reading — Garage would reject it. */
  hasMileage:    boolean
}

export interface GarageJobsRead {
  rows: GarageJobRow[]
  /** True when shop_jobs.garage_posted_at is missing — posting is blocked. */
  guardMissing: boolean
}

/**
 * Invoiced jobs and whether each has been filed into a customer's Garage.
 *
 * Scoped to `invoiced` because that is the point the shop considers the job
 * finished and billed; posting a job that is still open would put an unsettled
 * repair in the customer's permanent history.
 */
export async function loadGarageJobs(
  supabase: SupabaseClient,
  shopId: string,
  limit = 50,
): Promise<GarageJobsRead> {
  const jobs = await many<JobWithGarage>(() =>
    supabase
      .from('shop_jobs')
      .select('*')
      .eq('shop_id', shopId)
      .eq('status', 'invoiced')
      .eq('voided', false)
      .order('invoiced_at', { ascending: false, nullsFirst: false })
      .limit(limit)
      .returns<JobWithGarage[]>(),
  )

  // `select('*')` cannot tell us the column is absent, so infer it: if not one
  // returned row carries the key, migration 009 has not been applied here.
  const guardMissing =
    jobs.length > 0 && !jobs.some((j) => 'garage_posted_at' in j)

  const customerIds = [...new Set(jobs.map((j) => j.customer_id).filter((v): v is string => !!v))]
  const vehicleIds = [...new Set(jobs.map((j) => j.vehicle_id).filter((v): v is string => !!v))]

  const [customers, vehicles] = await Promise.all([
    customerIds.length
      ? many<ShopCustomer>(() =>
          supabase
            .from('shop_customers')
            .select('*')
            .eq('shop_id', shopId)
            .in('id', customerIds)
            .returns<ShopCustomer[]>(),
        )
      : Promise.resolve<ShopCustomer[]>([]),
    vehicleIds.length
      ? many<ShopVehicle>(() =>
          supabase
            .from('shop_vehicles')
            .select('*')
            .eq('shop_id', shopId)
            .in('id', vehicleIds)
            .returns<ShopVehicle[]>(),
        )
      : Promise.resolve<ShopVehicle[]>([]),
  ])

  const customerById = new Map(customers.map((c) => [c.id, c]))
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]))

  const rows: GarageJobRow[] = jobs.map((job) => {
    const customer = job.customer_id ? customerById.get(job.customer_id) ?? null : null
    const vehicle = job.vehicle_id ? vehicleById.get(job.vehicle_id) ?? null : null

    return {
      jobId:         job.id,
      jobNumber:     job.job_number,
      status:        job.status,
      customerName:  customerName(customer),
      customerEmail: customer?.email?.trim() || null,
      vehicleLabel:  vehicleLabel(vehicle),
      vin:           vehicle?.vin ?? null,
      mileage:       vehicle?.mileage ?? null,
      invoicedAt:    job.invoiced_at,
      completedAt:   job.completed_at,
      postedAt:      job.garage_posted_at ?? null,
      joinUrl:       buildGarageJoinUrl(
        vehicle
          ? {
              vin:     vehicle.vin,
              year:    vehicle.year,
              make:    vehicle.make,
              model:   vehicle.model,
              mileage: vehicle.mileage,
            }
          : null,
      ),
      hasMileage:    vehicle?.mileage != null,
    }
  })

  return { rows, guardMissing }
}

async function many<T>(run: () => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const { data } = await run()
    return data ?? []
  } catch {
    return []
  }
}

async function one<T>(run: () => PromiseLike<{ data: T | null }>): Promise<T | null> {
  try {
    const { data } = await run()
    return data ?? null
  } catch {
    return null
  }
}

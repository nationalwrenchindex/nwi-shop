// Reads and writes for the two TorqueWrench tables.
//
// EVERY function here degrades rather than throws. `shop_review_settings` and
// `shop_review_requests` arrive in migration 009, which is not applied in every
// environment yet, so a missing table has to render an honest empty state on the
// tool page instead of a 500. `tablesMissing` on the result is what the UI reads
// to say so out loud rather than pretending the shop has no requests.

import type { SupabaseClient } from '@supabase/supabase-js'
import { customerName } from '@/lib/shop/jobs'
import type { ShopCustomer, ShopJob } from '@/lib/types'
import {
  DEFAULT_DELAY_MINUTES,
  defaultReviewSettings,
  MAX_DELAY_MINUTES,
  MIN_DELAY_MINUTES,
  type ReviewRequestRow,
  type ReviewSettingsInput,
  type ShopReviewRequest,
  type ShopReviewSettings,
} from './types'

/** PostgREST codes that mean "the migration has not been applied here". */
const MISSING_TABLE_CODES = new Set(['42P01', '42703', 'PGRST205', 'PGRST204'])

export function isMissingSchema(error: { code?: string | null } | null): boolean {
  return !!error?.code && MISSING_TABLE_CODES.has(error.code)
}

export interface SettingsRead {
  settings: ShopReviewSettings
  /** True when the row was defaulted because the table is not there yet. */
  tablesMissing: boolean
}

export async function loadReviewSettings(
  supabase: SupabaseClient,
  shopId: string,
): Promise<SettingsRead> {
  try {
    const { data, error } = await supabase
      .from('shop_review_settings')
      .select('*')
      .eq('shop_id', shopId)
      .maybeSingle<ShopReviewSettings>()

    if (error) {
      return { settings: defaultReviewSettings(shopId), tablesMissing: isMissingSchema(error) }
    }
    // No row yet is normal: a shop that has never opened the tool. Defaults are
    // disabled, so nothing goes out until someone deliberately turns it on.
    return { settings: data ?? defaultReviewSettings(shopId), tablesMissing: false }
  } catch {
    return { settings: defaultReviewSettings(shopId), tablesMissing: true }
  }
}

/** Clamps the delay to a sane window and coerces a blank template to null. */
export function normalizeSettingsInput(input: ReviewSettingsInput): ReviewSettingsInput {
  const delay = Number.isFinite(input.delay_minutes)
    ? Math.round(input.delay_minutes)
    : DEFAULT_DELAY_MINUTES

  return {
    is_enabled:             input.is_enabled,
    google_place_id:        input.google_place_id?.trim() || null,
    service_recovery_phone: input.service_recovery_phone?.trim() || null,
    delay_minutes:          Math.min(MAX_DELAY_MINUTES, Math.max(MIN_DELAY_MINUTES, delay)),
    message_template:       input.message_template?.trim() || null,
  }
}

export type SettingsSave =
  | { ok: true; settings: ShopReviewSettings }
  | { ok: false; message: string; tablesMissing: boolean }

export async function saveReviewSettings(
  supabase: SupabaseClient,
  shopId: string,
  input: ReviewSettingsInput,
): Promise<SettingsSave> {
  const patch = normalizeSettingsInput(input)

  // Turning the feature on without a place id would queue requests that the
  // sender then skips forever, and the shop would never know why. Refuse here.
  if (patch.is_enabled && !patch.google_place_id) {
    return {
      ok: false,
      tablesMissing: false,
      message: 'Add your Google Place ID before turning review requests on.',
    }
  }

  try {
    const { data, error } = await supabase
      .from('shop_review_settings')
      .upsert(
        { shop_id: shopId, ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'shop_id' },
      )
      .select('*')
      .maybeSingle<ShopReviewSettings>()

    if (error || !data) {
      return {
        ok: false,
        tablesMissing: isMissingSchema(error),
        message: isMissingSchema(error)
          ? 'Review request settings are not set up on this database yet.'
          : error?.message ?? 'Could not save these settings.',
      }
    }
    return { ok: true, settings: data }
  } catch (err) {
    return {
      ok: false,
      tablesMissing: true,
      message: err instanceof Error ? err.message : 'Could not save these settings.',
    }
  }
}

export interface RequestsRead {
  rows: ReviewRequestRow[]
  tablesMissing: boolean
}

/**
 * The dashboard list. The job number and customer name are resolved with two
 * follow-up queries rather than a PostgREST embed, because the foreign keys are
 * brand new and an embed fails hard the moment one is named differently.
 */
export async function loadReviewRequests(
  supabase: SupabaseClient,
  shopId: string,
  limit = 50,
): Promise<RequestsRead> {
  let requests: ShopReviewRequest[]
  try {
    const { data, error } = await supabase
      .from('shop_review_requests')
      .select('*')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(limit)
      .returns<ShopReviewRequest[]>()

    if (error) return { rows: [], tablesMissing: isMissingSchema(error) }
    requests = data ?? []
  } catch {
    return { rows: [], tablesMissing: true }
  }

  if (requests.length === 0) return { rows: [], tablesMissing: false }

  const jobIds = [...new Set(requests.map((r) => r.job_id).filter(Boolean))]
  const customerIds = [
    ...new Set(requests.map((r) => r.customer_id).filter((v): v is string => !!v)),
  ]

  const [jobs, customers] = await Promise.all([
    safeRows<Pick<ShopJob, 'id' | 'job_number'>>(() =>
      supabase
        .from('shop_jobs')
        .select('id, job_number')
        .eq('shop_id', shopId)
        .in('id', jobIds)
        .returns<Pick<ShopJob, 'id' | 'job_number'>[]>(),
    ),
    customerIds.length
      ? safeRows<Pick<ShopCustomer, 'id' | 'first_name' | 'last_name' | 'company'>>(() =>
          supabase
            .from('shop_customers')
            .select('id, first_name, last_name, company')
            .eq('shop_id', shopId)
            .in('id', customerIds)
            .returns<Pick<ShopCustomer, 'id' | 'first_name' | 'last_name' | 'company'>[]>(),
        )
      : Promise.resolve([]),
  ])

  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const customerById = new Map(customers.map((c) => [c.id, c]))

  const rows: ReviewRequestRow[] = requests.map((r) => ({
    id:            r.id,
    job_id:        r.job_id,
    job_number:    jobById.get(r.job_id)?.job_number ?? null,
    customer_name: customerName(
      r.customer_id ? customerById.get(r.customer_id) ?? null : null,
    ),
    phone:         r.phone,
    status:        r.status,
    created_at:    r.created_at,
    sent_at:       r.sent_at,
    clicked_at:    r.clicked_at,
    rating:        r.rating,
    error:         r.error,
  }))

  return { rows, tablesMissing: false }
}

async function safeRows<T>(run: () => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const { data } = await run()
    return data ?? []
  } catch {
    return []
  }
}

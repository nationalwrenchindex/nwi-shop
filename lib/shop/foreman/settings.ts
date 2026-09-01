// Read/write for `shop_foreman_settings` and `shop_foreman_calls`.
//
// Everything here degrades: those tables arrive in migration 009 and may not be
// applied yet, so a missing table comes back as a typed "not set up" result
// rather than an exception in the middle of a phone call.

import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Row shapes (migration 009)
// ---------------------------------------------------------------------------

export interface ShopForemanSettings {
  shop_id:              string
  /** The number callers dial. Provisioned by hand — see provision.ts. */
  phone_number:         string | null
  vapi_phone_number_id: string | null
  is_enabled:           boolean
  greeting:             string | null
  working_hours_start:  string | null
  working_hours_end:    string | null
  working_days:         string[] | null
  after_hours_message:  string | null
  services_list:        string | null
  updated_at:           string | null
}

export interface ShopForemanCall {
  id:               string
  shop_id:          string
  vapi_call_id:     string
  from_number:      string | null
  started_at:       string | null
  ended_at:         string | null
  duration_seconds: number | null
  transcript:       string | null
  summary:          string | null
  outcome:          string | null
  job_id:           string | null
  customer_id:      string | null
  created_at:       string
}

/** Patchable subset — shop_id, phone_number and the Vapi id are not user-editable. */
export type ForemanSettingsPatch = Partial<
  Pick<
    ShopForemanSettings,
    | 'is_enabled'
    | 'greeting'
    | 'working_hours_start'
    | 'working_hours_end'
    | 'working_days'
    | 'after_hours_message'
    | 'services_list'
  >
>

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_WORKING_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const

export const WEEKDAY_ABBREVIATIONS = [
  'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
] as const

export type WeekdayAbbreviation = (typeof WEEKDAY_ABBREVIATIONS)[number]

export const DEFAULT_HOURS_START = '08:00'
export const DEFAULT_HOURS_END = '18:00'

export const DEFAULT_AFTER_HOURS_MESSAGE =
  'Thanks for calling. We are closed right now, but I can take your details and get you on the schedule.'

export function isWeekdayAbbreviation(value: unknown): value is WeekdayAbbreviation {
  return typeof value === 'string' && (WEEKDAY_ABBREVIATIONS as readonly string[]).includes(value)
}

/** A settings object for a shop that has no row yet. Never written implicitly. */
export function defaultSettings(shopId: string): ShopForemanSettings {
  return {
    shop_id:              shopId,
    phone_number:         null,
    vapi_phone_number_id: null,
    is_enabled:           false,
    greeting:             null,
    working_hours_start:  DEFAULT_HOURS_START,
    working_hours_end:    DEFAULT_HOURS_END,
    working_days:         [...DEFAULT_WORKING_DAYS],
    after_hours_message:  DEFAULT_AFTER_HOURS_MESSAGE,
    services_list:        null,
    updated_at:           null,
  }
}

// ---------------------------------------------------------------------------
// Missing-table detection
// ---------------------------------------------------------------------------

/** Postgres `undefined_table`, plus PostgREST's schema-cache miss for the same. */
export function isMissingTable(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code ?? ''
  return code === '42P01' || code === 'PGRST205'
}

export const MISSING_TABLE_MESSAGE =
  'The Foreman AI tables have not been created in this database yet. Apply the pending migration and reload.'

// ---------------------------------------------------------------------------
// Phone helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a US/NANP number to E.164 so a number stored as "(336) 555-0100"
 * still matches the "+13365550100" Vapi sends. Returns null for anything that
 * is not a plausible number rather than guessing.
 */
export function normalizeE164(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = String(raw).trim()

  // Already-international numbers outside NANP are passed through unchanged.
  if (/^\+(?!1)\d{7,15}$/.test(trimmed)) return trimmed

  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

// ---------------------------------------------------------------------------
// Reads and writes
// ---------------------------------------------------------------------------

export type SettingsResult =
  | { ok: true;  settings: ShopForemanSettings; exists: boolean }
  | { ok: false; reason: 'missing_table' | 'error'; message: string }

export async function loadForemanSettings(
  supabase: SupabaseClient,
  shopId: string,
): Promise<SettingsResult> {
  const { data, error } = await supabase
    .from('shop_foreman_settings')
    .select('*')
    .eq('shop_id', shopId)
    .maybeSingle<ShopForemanSettings>()

  if (error) {
    if (isMissingTable(error)) {
      return { ok: false, reason: 'missing_table', message: MISSING_TABLE_MESSAGE }
    }
    return { ok: false, reason: 'error', message: error.message }
  }

  return data
    ? { ok: true, settings: data, exists: true }
    : { ok: true, settings: defaultSettings(shopId), exists: false }
}

/**
 * Upserts the shop's settings row. The row is keyed on shop_id (unique), so a
 * shop that has never opened this page gets its first row written here.
 */
export async function saveForemanSettings(
  supabase: SupabaseClient,
  shopId: string,
  patch: ForemanSettingsPatch,
): Promise<SettingsResult> {
  const { data, error } = await supabase
    .from('shop_foreman_settings')
    .upsert(
      { shop_id: shopId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'shop_id' },
    )
    .select('*')
    .maybeSingle<ShopForemanSettings>()

  if (error) {
    if (isMissingTable(error)) {
      return { ok: false, reason: 'missing_table', message: MISSING_TABLE_MESSAGE }
    }
    return { ok: false, reason: 'error', message: error.message }
  }

  return data
    ? { ok: true, settings: data, exists: true }
    : { ok: false, reason: 'error', message: 'Settings did not save.' }
}

/** Recent calls for the shop. Returns an empty list when the table is absent. */
export async function loadForemanCalls(
  supabase: SupabaseClient,
  shopId: string,
  limit = 25,
): Promise<{ calls: ShopForemanCall[]; missingTable: boolean }> {
  const { data, error } = await supabase
    .from('shop_foreman_calls')
    .select('*')
    .eq('shop_id', shopId)
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(limit)
    .returns<ShopForemanCall[]>()

  if (error) return { calls: [], missingTable: isMissingTable(error) }
  return { calls: data ?? [], missingTable: false }
}

// ---------------------------------------------------------------------------
// Inbound-call shop resolution
// ---------------------------------------------------------------------------

/**
 * Maps an inbound Vapi call back to a shop. `vapi_phone_number_id` is the
 * reliable key — Vapi always sends it and it never changes; the dialed number
 * is the fallback for events that omit it, matched on its E.164 form so a
 * differently-formatted stored value still resolves.
 *
 * Runs with the service client: the caller has no session, so RLS cannot be the
 * thing that scopes this. Everything downstream must filter by the shop_id this
 * returns.
 */
export async function resolveShopForCall(
  svc: SupabaseClient,
  args: { vapiPhoneNumberId?: string | null; calledNumber?: string | null },
): Promise<ShopForemanSettings | null> {
  if (args.vapiPhoneNumberId) {
    const { data } = await svc
      .from('shop_foreman_settings')
      .select('*')
      .eq('vapi_phone_number_id', args.vapiPhoneNumberId)
      .maybeSingle<ShopForemanSettings>()
    if (data) return data
  }

  const normalized = normalizeE164(args.calledNumber)
  if (normalized) {
    const { data } = await svc
      .from('shop_foreman_settings')
      .select('*')
      .eq('phone_number', normalized)
      .maybeSingle<ShopForemanSettings>()
    if (data) return data
  }

  return null
}

/**
 * Reduces a phone number to its last four digits for logging. Enough to
 * correlate a log line with a call, not enough to identify or contact anyone if
 * the log store is ever exposed.
 */
export function redactPhone(num: string | null | undefined): string {
  if (!num) return '(none)'
  const digits = String(num).replace(/\D/g, '')
  return digits.length >= 4 ? `***${digits.slice(-4)}` : '***'
}

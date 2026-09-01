// SERVER-ONLY reference reads for QuickWrench HD.
//
// Everything in this file touches `hd_*` tables. Those belong to NWI Suite,
// which shares this Supabase project with NWI Shop. They are GLOBAL catalogs
// with an authenticated-read RLS policy and no user write policy:
//
//   hd_parts            — master parts catalog (TK / Carrier / Delco Remy)
//   hd_parts_cross_ref  — supersession chains and OEM cross references
//   hd_bm_map           — build number → unit model + refrigerant type
//   hd_cached_diagnostics — Suite's own diagnostic response cache
//
// READ ONLY. NWI Shop never writes to an hd_* table, never upserts a cache row,
// and never calls Suite's /api/hd/*/seed routes (they delete-then-insert). If a
// query fails — table missing in this environment, policy change, network — we
// degrade to empty and carry on. A parts panel with nothing in it is a nuisance;
// a 500 in front of a tech holding a wrench is not acceptable.

import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Row shapes. Declared locally because these are Suite's tables, not ours —
// @/lib/types describes shop_* only and must not grow an hd_* dependency.
// ---------------------------------------------------------------------------

export interface HdPart {
  part_number:    string
  manufacturer:   string
  description:    string
  category:       string
  subcategory:    string | null
  engine:         string | null
  unit_models:    string[] | null
  notes:          string | null
  superseded_by:  string | null
  field_critical: boolean
}

export interface HdPartCrossRef {
  part_number: string
  cross_mfr:   string
  cross_part:  string
  cross_notes: string | null
}

export interface HdBuildNumber {
  manufacturer:     string
  bm_number:        string
  unit_model:       string | null
  refrigerant_type: string | null
  known_parts:      string | null
}

export interface HdCachedDiagnostic {
  result_html: string
  citations:   string[] | null
  source:      string | null
}

const PART_COLUMNS =
  'part_number, manufacturer, description, category, subcategory, engine, unit_models, notes, superseded_by, field_critical'

/** Every read in this module goes through here, so one failure mode: empty. */
async function safeRows<T>(
  label: string,
  run: () => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  try {
    const { data, error } = await run()
    if (error) {
      console.error(`[quickwrench-hd] ${label} read failed`, error)
      return []
    }
    return data ?? []
  } catch (err) {
    console.error(`[quickwrench-hd] ${label} read threw`, err)
    return []
  }
}

export interface PartsQuery {
  manufacturer?: string
  category?:     string
  /** Matched against hd_parts.unit_models with a `contains` filter. */
  unitModel?:    string
  /** Free-text match on part number or description. */
  search?:       string
  limit?:        number
}

/**
 * Parts lookup. Model scoping is a safety decision, not a convenience: when the
 * tech names a unit model we return ONLY parts whose unit_models array contains
 * that exact model. Showing the wrong belt for the wrong unit is a critical
 * failure, so unscoped/universal parts are intentionally excluded rather than
 * mixed in.
 */
export async function lookupParts(
  supabase: SupabaseClient,
  query: PartsQuery,
): Promise<HdPart[]> {
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 50)

  return safeRows<HdPart>('hd_parts', () => {
    let q = supabase.from('hd_parts').select(PART_COLUMNS).limit(limit)
    if (query.manufacturer) q = q.eq('manufacturer', query.manufacturer)
    if (query.category)     q = q.eq('category', query.category)
    if (query.unitModel)    q = q.contains('unit_models', [query.unitModel])
    if (query.search) {
      const term = query.search.replace(/[%,()]/g, ' ').trim()
      if (term) q = q.or(`part_number.ilike.%${term}%,description.ilike.%${term}%`)
    }
    return q.order('part_number', { ascending: true }).returns<HdPart[]>()
  })
}

/** Supersession chain and OEM cross references for a set of part numbers. */
export async function lookupCrossRefs(
  supabase: SupabaseClient,
  partNumbers: string[],
): Promise<HdPartCrossRef[]> {
  const wanted = partNumbers.filter((p) => p.trim().length > 0).slice(0, 25)
  if (wanted.length === 0) return []

  return safeRows<HdPartCrossRef>('hd_parts_cross_ref', () =>
    supabase
      .from('hd_parts_cross_ref')
      .select('part_number, cross_mfr, cross_part, cross_notes')
      .in('part_number', wanted)
      .limit(100)
      .returns<HdPartCrossRef[]>(),
  )
}

/**
 * Build-number (BM) decode → unit model and refrigerant type. `manufacturer` in
 * hd_bm_map is the short form ('TK' / 'Carrier'), not the display name.
 */
export async function lookupBuildNumber(
  supabase: SupabaseClient,
  bmNumber: string,
  manufacturer?: string,
): Promise<HdBuildNumber | null> {
  const bm = bmNumber.trim()
  if (!bm) return null

  const rows = await safeRows<HdBuildNumber>('hd_bm_map', () => {
    let q = supabase
      .from('hd_bm_map')
      .select('manufacturer, bm_number, unit_model, refrigerant_type, known_parts')
      .eq('bm_number', bm)
      .limit(5)
    if (manufacturer) q = q.eq('manufacturer', manufacturer)
    return q.returns<HdBuildNumber[]>()
  })

  return rows[0] ?? null
}

/**
 * Read NWI Suite's diagnostic cache. A hit skips the model call entirely, which
 * is the difference between an instant answer and a 20-second wait on a shop
 * tablet with one bar of signal.
 *
 * We NEVER write here. The table is Suite's, its RLS grants authenticated read
 * and no user write, and every write in Suite goes through a service-role
 * client. On ANY error — including "column citations does not exist" in an
 * older environment — this returns null and the caller proceeds to a live model
 * call. That is the whole failure policy: the cache is an optimisation, never a
 * dependency.
 */
export async function readCachedDiagnostic(
  supabase: SupabaseClient,
  cacheKey: string,
): Promise<HdCachedDiagnostic | null> {
  const key = cacheKey.trim()
  if (!key) return null

  try {
    const { data, error } = await supabase
      .from('hd_cached_diagnostics')
      .select('result_html, citations, source')
      .eq('cache_key', key)
      .maybeSingle<HdCachedDiagnostic>()
    if (error) {
      console.error('[quickwrench-hd] cache read failed — running live', error)
      return null
    }
    return data?.result_html ? data : null
  } catch (err) {
    console.error('[quickwrench-hd] cache read threw — running live', err)
    return null
  }
}

/**
 * Cache keys are built to match the keys NWI Suite already writes, so a shop
 * benefits from every diagnostic Suite has generated. Keep these in step with
 * Suite's route if that ever changes; a drifted key is only a miss, never a
 * wrong answer.
 */
export function truckCacheKey(
  truckBrand: string,
  engineModel: string,
  spn: string,
  fmi: string,
): string {
  return `truck-${truckBrand}-${engineModel}-${spn}-${fmi}`
}

export function reeferCacheKey(
  manufacturer: string,
  unitModel: string,
  alarmCode: string,
): string {
  return unitModel
    ? `reefer-${manufacturer}-${unitModel}-${alarmCode}`
    : `reefer-${manufacturer}-${alarmCode}`
}

// ---------------------------------------------------------------------------
// Reefer alarm codes live in another tool, owned by another part of the app.
// We ask its route for a definition and treat every failure as "no definition
// available" — this tool must not break because a sibling tool is not deployed.
// ---------------------------------------------------------------------------

export interface ReeferAlarmDefinition {
  code:           string
  description:    string
  severity?:      string
  operatorAction?: string
}

export async function lookupReeferAlarm(
  origin: string,
  code: string,
  manufacturer: string,
  cookie: string,
): Promise<ReeferAlarmDefinition | null> {
  const trimmed = code.trim()
  if (!trimmed) return null

  try {
    const url = new URL('/api/shop/tools/reefer-alarm-codes', origin)
    url.searchParams.set('code', trimmed)
    url.searchParams.set('manufacturer', manufacturer)

    const res = await fetch(url, {
      headers: cookie ? { cookie } : {},
      cache:   'no-store',
      signal:  AbortSignal.timeout(4_000),
    })
    if (!res.ok) return null

    const body: unknown = await res.json()
    if (!body || typeof body !== 'object') return null

    // The sibling route is owned by another agent and may not exist yet, so we
    // accept a bare object or a { code: {...} } / { codes: [...] } wrapper and
    // read only the fields we can verify are strings. First candidate that
    // actually carries a description wins; anything else is treated as absent.
    const record = body as Record<string, unknown>
    const candidates: unknown[] = [
      Array.isArray(record.codes) ? record.codes[0] : null,
      record.code,
      record.alarm,
      record,
    ]

    const row = candidates.find(
      (c): c is Record<string, unknown> =>
        typeof c === 'object' && c !== null &&
        typeof (c as Record<string, unknown>).description === 'string',
    )
    if (!row) return null

    const description = row.description as string

    return {
      code:           trimmed,
      description,
      severity:       typeof row.severity === 'string' ? row.severity : undefined,
      operatorAction: typeof row.operator_action === 'string'
        ? row.operator_action
        : typeof row.operatorAction === 'string'
          ? row.operatorAction
          : undefined,
    }
  } catch {
    // Not deployed, wrong shape, timed out — all the same to us.
    return null
  }
}

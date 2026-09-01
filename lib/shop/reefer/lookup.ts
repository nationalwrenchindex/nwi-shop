// SERVER-ONLY. Merges the two forms reefer knowledge exists in:
//
//   1. The compile-time catalog in ./codes.ts — 372 entries straight out of
//      TK 40933-8-CH Rev 15 plus the Carrier operator references. Broad, shallow,
//      and always available.
//   2. The `hd_alarm_codes` table — ~100 curated rows shared with NWI Suite,
//      carrying the deep field data: diagnostic steps, common fix, parts needed,
//      book/mobile time, safety and shore-power warnings, wiring references.
//
// The catalog is the BASE. A matching DB row layers its richer fields on top; it
// never replaces the operator action, which is the documented manufacturer text.
// Rows in the table with no catalog counterpart are surfaced too, so a curated
// code Suite has added is not invisible here.
//
// `hd_alarm_codes` is a shared, global, published-spec catalog. This module only
// ever reads it — never write, never seed.

import { createClient } from '@/lib/supabase/server'
import {
  CARRIER_ALARM_CODES,
  CARRIER_PRETRIP_CODES,
  TK_ALARM_CODES,
  TK_DSR_ALARM_CODES,
  TK_DISCLAIMER,
  type TKSeverity,
} from './codes'

export { TK_DISCLAIMER }

export type ReeferManufacturer = 'TK' | 'Carrier'

/** Which book the code came out of. Drives the badge on the result card. */
export type ReeferCodeGroup = 'tk' | 'tk_dsr' | 'carrier' | 'carrier_pretrip'

export const GROUP_LABELS: Record<ReeferCodeGroup, string> = {
  tk:              'Thermo King',
  tk_dsr:          'Thermo King DSR / direct-smart reefer',
  carrier:         'Carrier Transicold',
  carrier_pretrip: 'Carrier Transicold pretrip',
}

export const SEVERITY_LABELS: Record<TKSeverity, string> = {
  immediate_action: 'Immediate action',
  check_specified:  'Check as specified',
  ok_to_run:        'OK to run',
}

/** One merged alarm: catalog base plus whatever the curated table added. */
export interface ReeferAlarm {
  code:            string
  manufacturer:    ReeferManufacturer
  group:           ReeferCodeGroup
  groupLabel:      string
  description:     string
  severity:        TKSeverity
  severityLabel:   string
  operatorAction:  string | null
  /** Where the fields came from — useful when a result looks thin. */
  source:          'catalog' | 'catalog+curated' | 'curated'
  // ---- curated overlay, all null when no hd_alarm_codes row matched ----
  unitFamily:        string | null
  displayText:       string | null
  meaning:           string | null
  commonCauses:      string | null
  diagnosticSteps:   string | null
  fieldNotes:        string | null
  commonFix:         string | null
  partsNeeded:       string | null
  safetyWarning:     string | null
  shorePowerWarning: boolean
  wiringReference:   string | null
  bookTime:          number | null
  mobileTime:        number | null
}

export interface ReeferLookupResult {
  results: ReeferAlarm[]
  /** Total matches before `limit` was applied. */
  total: number
  /**
   * True when the curated table could not be read and only the compile-time
   * catalog answered. Deliberate: a tech standing at a reefer at 2am with bad
   * signal still needs to know what alarm 18 means. We degrade, never fail.
   */
  degraded: boolean
  disclaimer: string
}

// ---------------------------------------------------------------------------
// Catalog side
// ---------------------------------------------------------------------------

interface CatalogEntry {
  code:           string
  manufacturer:   ReeferManufacturer
  group:          ReeferCodeGroup
  description:    string
  severity:       TKSeverity
  operatorAction: string
}

function collect(
  table: Record<string, { description: string; severity: TKSeverity; operatorAction: string }>,
  manufacturer: ReeferManufacturer,
  group: ReeferCodeGroup,
): CatalogEntry[] {
  return Object.entries(table).map(([code, entry]) => ({
    code,
    manufacturer,
    group,
    description:    entry.description,
    severity:       entry.severity,
    operatorAction: entry.operatorAction,
  }))
}

let catalogCache: CatalogEntry[] | null = null

/** Every compile-time entry, flattened. Built once per server process. */
export function catalogEntries(): CatalogEntry[] {
  if (!catalogCache) {
    catalogCache = [
      ...collect(TK_ALARM_CODES, 'TK', 'tk'),
      ...collect(TK_DSR_ALARM_CODES, 'TK', 'tk_dsr'),
      ...collect(CARRIER_ALARM_CODES, 'Carrier', 'carrier'),
      ...collect(CARRIER_PRETRIP_CODES, 'Carrier', 'carrier_pretrip'),
    ]
  }
  return catalogCache
}

// ---------------------------------------------------------------------------
// Curated table side
// ---------------------------------------------------------------------------

interface AlarmCodeRow {
  manufacturer:        string | null
  unit_family:         string | null
  alarm_code:          string | null
  display_text:        string | null
  meaning:             string | null
  severity:            string | null
  common_causes:       string | null
  diagnostic_steps:    string | null
  field_notes:         string | null
  common_fix:          string | null
  parts_needed:        string | null
  safety_warning:      string | null
  shore_power_warning: boolean | null
  wiring_reference:    string | null
  book_time:           number | string | null
  mobile_time:         number | string | null
}

const ROW_COLUMNS = [
  'manufacturer',
  'unit_family',
  'alarm_code',
  'display_text',
  'meaning',
  'severity',
  'common_causes',
  'diagnostic_steps',
  'field_notes',
  'common_fix',
  'parts_needed',
  'safety_warning',
  'shore_power_warning',
  'wiring_reference',
  'book_time',
  'mobile_time',
].join(',')

/**
 * `hd_alarm_codes.severity` is its own four-value enum. Fold it onto the TK
 * three-value scale so one badge vocabulary covers both sources.
 */
function normalizeDbSeverity(value: string | null): TKSeverity {
  switch (value) {
    case 'immediate': return 'immediate_action'
    case 'info':      return 'ok_to_run'
    default:          return 'check_specified'
  }
}

function normalizeManufacturer(value: string | null): ReeferManufacturer | null {
  if (!value) return null
  const upper = value.trim().toUpperCase()
  if (upper === 'TK' || upper.startsWith('THERMO')) return 'TK'
  if (upper.startsWith('CARRIER')) return 'Carrier'
  return null
}

/**
 * Codes are written inconsistently across sources: TK pads to two digits ("02"),
 * Carrier does not ("2"), and either may arrive with an "AL" prefix or spaces.
 * Reduce to a comparable key, scoped per manufacturer so TK 02 never collides
 * with Carrier 2.
 */
function codeKey(manufacturer: ReeferManufacturer, code: string): string {
  let normal = code.trim().toUpperCase().replace(/[\s.]/g, '')
  normal = normal.replace(/^(AL|ALARM|CODE)[-#]?/, '')
  if (/^\d+$/.test(normal)) normal = String(Number(normal))
  else if (/^P\d+$/.test(normal)) normal = `P${Number(normal.slice(1))}`
  return `${manufacturer}:${normal}`
}

function toNumberOrNull(value: number | string | null): number | null {
  if (value === null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function guessGroup(row: AlarmCodeRow, manufacturer: ReeferManufacturer): ReeferCodeGroup {
  const code = (row.alarm_code ?? '').trim().toUpperCase()
  if (manufacturer === 'Carrier') return /^P\d/.test(code) ? 'carrier_pretrip' : 'carrier'
  return /^[A-Z-]/.test(code) ? 'tk_dsr' : 'tk'
}

/**
 * Reads the shared curated table. Returns null — not a throw — on any failure,
 * so every caller can keep going on the compile-time catalog alone.
 */
async function readCuratedRows(): Promise<AlarmCodeRow[] | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('hd_alarm_codes')
      .select(ROW_COLUMNS)
      .returns<AlarmCodeRow[]>()

    if (error) return null
    return data ?? []
  } catch {
    // Network down, env missing, table not present in this project — all the
    // same to a tech at a reefer: fall back rather than show an error page.
    return null
  }
}

// ---------------------------------------------------------------------------
// Merge + query
// ---------------------------------------------------------------------------

function baseAlarm(entry: CatalogEntry): ReeferAlarm {
  return {
    code:           entry.code,
    manufacturer:   entry.manufacturer,
    group:          entry.group,
    groupLabel:     GROUP_LABELS[entry.group],
    description:    entry.description,
    severity:       entry.severity,
    severityLabel:  SEVERITY_LABELS[entry.severity],
    operatorAction: entry.operatorAction,
    source:         'catalog',
    unitFamily:        null,
    displayText:       null,
    meaning:           null,
    commonCauses:      null,
    diagnosticSteps:   null,
    fieldNotes:        null,
    commonFix:         null,
    partsNeeded:       null,
    safetyWarning:     null,
    shorePowerWarning: false,
    wiringReference:   null,
    bookTime:          null,
    mobileTime:        null,
  }
}

function applyRow(alarm: ReeferAlarm, row: AlarmCodeRow): ReeferAlarm {
  return {
    ...alarm,
    source:            'catalog+curated',
    unitFamily:        row.unit_family ?? alarm.unitFamily,
    displayText:       row.display_text ?? alarm.displayText,
    meaning:           row.meaning ?? alarm.meaning,
    commonCauses:      row.common_causes ?? alarm.commonCauses,
    diagnosticSteps:   row.diagnostic_steps ?? alarm.diagnosticSteps,
    fieldNotes:        row.field_notes ?? alarm.fieldNotes,
    commonFix:         row.common_fix ?? alarm.commonFix,
    partsNeeded:       row.parts_needed ?? alarm.partsNeeded,
    safetyWarning:     row.safety_warning ?? alarm.safetyWarning,
    shorePowerWarning: alarm.shorePowerWarning || row.shore_power_warning === true,
    wiringReference:   row.wiring_reference ?? alarm.wiringReference,
    bookTime:          toNumberOrNull(row.book_time) ?? alarm.bookTime,
    mobileTime:        toNumberOrNull(row.mobile_time) ?? alarm.mobileTime,
  }
}

function curatedOnlyAlarm(row: AlarmCodeRow, manufacturer: ReeferManufacturer): ReeferAlarm {
  const group = guessGroup(row, manufacturer)
  const severity = normalizeDbSeverity(row.severity)
  return {
    code:           (row.alarm_code ?? row.display_text ?? '').trim(),
    manufacturer,
    group,
    groupLabel:     GROUP_LABELS[group],
    description:    row.display_text ?? row.meaning ?? 'Alarm',
    severity,
    severityLabel:  SEVERITY_LABELS[severity],
    operatorAction: null,
    source:         'curated',
    unitFamily:        row.unit_family,
    displayText:       row.display_text,
    meaning:           row.meaning,
    commonCauses:      row.common_causes,
    diagnosticSteps:   row.diagnostic_steps,
    fieldNotes:        row.field_notes,
    commonFix:         row.common_fix,
    partsNeeded:       row.parts_needed,
    safetyWarning:     row.safety_warning,
    shorePowerWarning: row.shore_power_warning === true,
    wiringReference:   row.wiring_reference,
    bookTime:          toNumberOrNull(row.book_time),
    mobileTime:        toNumberOrNull(row.mobile_time),
  }
}

/** Everything an alarm can be searched by, lower-cased and joined. */
function haystack(alarm: ReeferAlarm): string {
  return [
    alarm.code,
    alarm.description,
    alarm.displayText,
    alarm.meaning,
    alarm.commonCauses,
    alarm.commonFix,
    alarm.fieldNotes,
    alarm.partsNeeded,
    alarm.unitFamily,
    alarm.operatorAction,
  ]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' ')
    .toLowerCase()
}

const SEVERITY_RANK: Record<TKSeverity, number> = {
  immediate_action: 0,
  check_specified:  1,
  ok_to_run:        2,
}

/** Numeric codes sort numerically; lettered ones fall in after, alphabetically. */
function compareCodes(a: ReeferAlarm, b: ReeferAlarm): number {
  const na = Number(a.code)
  const nb = Number(b.code)
  const aNum = Number.isFinite(na)
  const bNum = Number.isFinite(nb)
  if (aNum && bNum) return na - nb
  if (aNum) return -1
  if (bNum) return 1
  return a.code.localeCompare(b.code)
}

export interface ReeferLookupQuery {
  /** Exact-ish code match. "02", "2", "AL 02" and "p141" all work. */
  code?:         string | null
  manufacturer?: string | null
  /** Free text across code, description, meaning, causes, fix and notes. */
  q?:            string | null
  limit?:        number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 400

/**
 * The one entry point. Builds the merged set, then filters it. Merging first
 * (rather than filtering each source) keeps a curated-only row findable by a
 * symptom search and a catalog-only code findable by number, with no special
 * cases at the call site.
 */
export async function lookupAlarms(query: ReeferLookupQuery): Promise<ReeferLookupResult> {
  const rows = await readCuratedRows()
  const degraded = rows === null

  const byKey = new Map<string, AlarmCodeRow[]>()
  for (const row of rows ?? []) {
    const manufacturer = normalizeManufacturer(row.manufacturer)
    if (!manufacturer || !row.alarm_code) continue
    const key = codeKey(manufacturer, row.alarm_code)
    const bucket = byKey.get(key)
    if (bucket) bucket.push(row)
    else byKey.set(key, [row])
  }

  const consumed = new Set<string>()
  const merged: ReeferAlarm[] = catalogEntries().map((entry) => {
    const key = codeKey(entry.manufacturer, entry.code)
    const matches = byKey.get(key)
    if (!matches || matches.length === 0) return baseAlarm(entry)
    consumed.add(key)
    // Several unit families can document the same code. Layer them in order so
    // the merged record carries the union of whatever anyone filled in.
    return matches.reduce(applyRow, baseAlarm(entry))
  })

  for (const [key, bucket] of byKey) {
    if (consumed.has(key)) continue
    for (const row of bucket) {
      const manufacturer = normalizeManufacturer(row.manufacturer)
      if (!manufacturer) continue
      merged.push(curatedOnlyAlarm(row, manufacturer))
    }
  }

  const manufacturer = normalizeManufacturer(query.manufacturer ?? null)
  const code = (query.code ?? '').trim()
  const term = (query.q ?? '').trim().toLowerCase()

  let filtered = merged
  if (manufacturer) filtered = filtered.filter((a) => a.manufacturer === manufacturer)

  if (code) {
    // Compare on the normalized key so "2", "02" and "AL02" all land on the
    // same TK alarm. Manufacturer is part of the key, so an unfiltered code
    // search legitimately returns both a TK and a Carrier hit.
    const wanted = new Set(
      (manufacturer ? [manufacturer] : (['TK', 'Carrier'] as ReeferManufacturer[])).map((m) =>
        codeKey(m, code),
      ),
    )
    filtered = filtered.filter((a) => wanted.has(codeKey(a.manufacturer, a.code)))
  }

  if (term) {
    filtered = filtered.filter((a) => haystack(a).includes(term))
  }

  const sorted = [...filtered].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.manufacturer.localeCompare(b.manufacturer) ||
      compareCodes(a, b),
  )

  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT)

  return {
    results:    sorted.slice(0, limit),
    total:      sorted.length,
    degraded,
    disclaimer: TK_DISCLAIMER,
  }
}

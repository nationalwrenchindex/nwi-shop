// SERVER-ONLY. Cross-reference lookup over the catalogs NWI Shop shares with
// NWI Suite. Read-only — these are global published manufacturer specs with no
// tenancy column, and Shop is a consumer of them, never a writer.
//
//   hd_parts_reference  (~950 rows)  OEM number -> Baldwin / NAPA Gold /
//                                    Luber-finer / Donaldson / Fleetguard / WIX /
//                                    Dayco / Continental / Gates
//   hd_parts            (~277 rows)  master catalog with supersession chains
//   hd_parts_cross_ref               per-part cross references keyed on part_number
//
// Both sources are normalized onto one `PartMatch` so the UI renders a single
// table and the "add to inventory" control has one shape to submit.

import { createClient } from '@/lib/supabase/server'

/** One vendor equivalent for an OEM part. */
export interface CrossReference {
  /** Baldwin, NAPA Gold, Gates, or whatever hd_parts_cross_ref recorded. */
  brand: string
  part:  string
  notes: string | null
}

export interface PartMatch {
  /** Stable within a result set; not a database id the client should trust. */
  key:            string
  oemPartNumber:  string | null
  description:    string
  manufacturer:   string | null
  category:       string | null
  /** Reefer unit family (X4, Precedent, SB-210) or model list, when known. */
  unitFamily:     string | null
  supersededBy:   string | null
  notes:          string | null
  /** Flagged in hd_parts as a part you do not want to be without on a road call. */
  fieldCritical:  boolean
  crossRefs:      CrossReference[]
  source:         'reference' | 'catalog'
}

export interface PartsSearchResult {
  results: PartMatch[]
  total:   number
  /** Distinct manufacturers/categories present, for the filter selects. */
  manufacturers: string[]
  categories:    string[]
  /**
   * True when one or both catalogs could not be read. The page still renders
   * whatever did come back rather than failing outright.
   */
  degraded: boolean
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface PartsReferenceRow {
  id:              string
  manufacturer:    string | null
  unit_family:     string | null
  part_category:   string | null
  part_function:   string | null
  oem_part_number: string | null
  baldwin:         string | null
  napa_gold:       string | null
  luber_finer:     string | null
  donaldson:       string | null
  fleetguard:      string | null
  wix:             string | null
  dayco:           string | null
  continental:     string | null
  gates:           string | null
  notes:           string | null
}

interface PartRow {
  id:             string
  part_number:    string
  manufacturer:   string | null
  description:    string
  category:       string | null
  unit_models:    string[] | null
  notes:          string | null
  superseded_by:  string | null
  field_critical: boolean | null
}

interface PartCrossRefRow {
  part_number: string
  cross_mfr:   string
  cross_part:  string
  cross_notes: string | null
}

/** hd_parts_reference columns, in the order the brand columns are displayed. */
const REFERENCE_BRANDS: { column: keyof PartsReferenceRow; brand: string }[] = [
  { column: 'baldwin',     brand: 'Baldwin' },
  { column: 'napa_gold',   brand: 'NAPA Gold' },
  { column: 'luber_finer', brand: 'Luber-finer' },
  { column: 'donaldson',   brand: 'Donaldson' },
  { column: 'fleetguard',  brand: 'Fleetguard' },
  { column: 'wix',         brand: 'WIX' },
  { column: 'dayco',       brand: 'Dayco' },
  { column: 'continental', brand: 'Continental' },
  { column: 'gates',       brand: 'Gates' },
]

const REFERENCE_COLUMNS =
  'id,manufacturer,unit_family,part_category,part_function,oem_part_number,' +
  'baldwin,napa_gold,luber_finer,donaldson,fleetguard,wix,dayco,continental,gates,notes'

const PART_COLUMNS =
  'id,part_number,manufacturer,description,category,unit_models,notes,superseded_by,field_critical'

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // Suite records "not applicable" cells in a few different ways; none of them
  // are a part number, and showing them as one wastes a tech's time.
  const lower = trimmed.toLowerCase()
  if (lower === 'n/a' || lower === 'na' || lower === '-' || lower === 'none') return null
  return trimmed
}

/**
 * Part numbers are written with dashes, spaces and mixed case depending on who
 * typed them. Compare on a stripped form so "11-9959", "119959" and "11 9959"
 * are one part.
 */
export function normalizePartNumber(value: string): string {
  return value.replace(/[\s\-./]/g, '').toUpperCase()
}

/**
 * A single cell often carries more than one number — hd_parts_reference records
 * TK's old and new numbers as "11-7382 / 127382", and some cross-ref cells list
 * two equivalents comma-separated. Split before normalizing so each number is
 * independently matchable; without this, searching the older number only ever
 * scores as a substring hit.
 */
function splitPartNumbers(value: string): string[] {
  return value
    .split(/\s*[/,;]\s*|\s+or\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/**
 * The number to actually stock a part under. A reference cell can list an old
 * and a new number ("11-7382 / 127382"); the whole string is not a part number
 * and must never be written into shop_inventory.
 */
export function primaryPartNumber(value: string): string {
  return splitPartNumbers(value)[0] ?? value.trim()
}

function referenceToMatch(row: PartsReferenceRow): PartMatch {
  const crossRefs: CrossReference[] = []
  for (const { column, brand } of REFERENCE_BRANDS) {
    const part = clean(row[column] as string | null)
    if (part) crossRefs.push({ brand, part, notes: null })
  }

  // The two columns only read as a part name together: part_category is the
  // bucket ("Filter") and part_function what it actually does ("Engine Oil
  // Lube"). Either alone is too thin to hand to a parts counter, so join them —
  // this string is also what gets written as the inventory description.
  const category = clean(row.part_category)
  const fn = clean(row.part_function)
  const description =
    category && fn && !fn.toLowerCase().includes(category.toLowerCase())
      ? `${category} — ${fn}`
      : (fn ?? category ?? 'Part')

  return {
    key:           `ref:${row.id}`,
    oemPartNumber: clean(row.oem_part_number),
    description,
    manufacturer:  clean(row.manufacturer),
    category,
    unitFamily:    clean(row.unit_family),
    supersededBy:  null,
    notes:         clean(row.notes),
    fieldCritical: false,
    crossRefs,
    source:        'reference',
  }
}

function partToMatch(row: PartRow, crossRefs: CrossReference[]): PartMatch {
  const models = (row.unit_models ?? []).filter((m) => typeof m === 'string' && m.trim())
  return {
    key:           `part:${row.id}`,
    oemPartNumber: clean(row.part_number),
    description:   clean(row.description) ?? 'Part',
    manufacturer:  clean(row.manufacturer),
    category:      clean(row.category),
    unitFamily:    models.length ? models.join(', ') : null,
    supersededBy:  clean(row.superseded_by),
    notes:         clean(row.notes),
    fieldCritical: row.field_critical === true,
    crossRefs,
    source:        'catalog',
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

async function readReference(
  supabase: SupabaseServerClient,
): Promise<PartsReferenceRow[] | null> {
  try {
    const { data, error } = await supabase
      .from('hd_parts_reference')
      .select(REFERENCE_COLUMNS)
      .returns<PartsReferenceRow[]>()
    if (error) return null
    return data ?? []
  } catch {
    return null
  }
}

async function readCatalog(
  supabase: SupabaseServerClient,
): Promise<{ parts: PartRow[]; crossRefs: PartCrossRefRow[] } | null> {
  try {
    const [parts, crossRefs] = await Promise.all([
      supabase.from('hd_parts').select(PART_COLUMNS).returns<PartRow[]>(),
      supabase
        .from('hd_parts_cross_ref')
        .select('part_number,cross_mfr,cross_part,cross_notes')
        .returns<PartCrossRefRow[]>(),
    ])
    if (parts.error) return null
    return {
      parts:     parts.data ?? [],
      // A cross-ref failure is survivable — the part itself is still useful.
      crossRefs: crossRefs.error ? [] : (crossRefs.data ?? []),
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function haystack(match: PartMatch): string {
  return [
    match.oemPartNumber,
    match.description,
    match.manufacturer,
    match.category,
    match.unitFamily,
    match.notes,
    match.supersededBy,
    ...match.crossRefs.flatMap((x) => [x.brand, x.part]),
  ]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' ')
    .toLowerCase()
}

/** Every part number on the record, normalized, for exact-number matching. */
function numberKeys(match: PartMatch): string[] {
  const values = [match.oemPartNumber, match.supersededBy, ...match.crossRefs.map((x) => x.part)]
  return values
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .flatMap(splitPartNumbers)
    .map(normalizePartNumber)
}

export interface PartsSearchQuery {
  /** Part number or free text. A number match ranks above a text match. */
  q?:            string | null
  manufacturer?: string | null
  category?:     string | null
  limit?:        number
}

const DEFAULT_LIMIT = 60
const MAX_LIMIT = 300

function uniqueSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b))
}

/**
 * Loads both catalogs, normalizes them into one list, then filters. The full
 * set is ~1,200 rows of published spec data, so filtering in memory keeps the
 * ranking rules (exact part number first) in one readable place rather than
 * splitting them across two different `or()` strings.
 */
export async function searchParts(query: PartsSearchQuery): Promise<PartsSearchResult> {
  const supabase = await createClient()
  const [reference, catalog] = await Promise.all([
    readReference(supabase),
    readCatalog(supabase),
  ])

  const degraded = reference === null || catalog === null

  const crossByPart = new Map<string, CrossReference[]>()
  for (const row of catalog?.crossRefs ?? []) {
    const brand = clean(row.cross_mfr)
    const part = clean(row.cross_part)
    if (!brand || !part) continue
    const entry: CrossReference = { brand, part, notes: clean(row.cross_notes) }
    const bucket = crossByPart.get(row.part_number)
    if (bucket) bucket.push(entry)
    else crossByPart.set(row.part_number, [entry])
  }

  const all: PartMatch[] = [
    ...(reference ?? []).map(referenceToMatch),
    ...(catalog?.parts ?? []).map((row) =>
      partToMatch(row, crossByPart.get(row.part_number) ?? []),
    ),
  ]

  const manufacturers = uniqueSorted(all.map((m) => m.manufacturer))
  const categories = uniqueSorted(all.map((m) => m.category))

  const manufacturer = clean(query.manufacturer ?? null)
  const category = clean(query.category ?? null)
  const term = (query.q ?? '').trim()

  let filtered = all
  if (manufacturer) {
    const wanted = manufacturer.toLowerCase()
    filtered = filtered.filter((m) => {
      const value = (m.manufacturer ?? '').toLowerCase()
      // hd_parts_reference uses "Both" for a part shared by TK and Carrier —
      // filtering to either manufacturer must still surface it.
      return value === wanted || value === 'both'
    })
  }
  if (category) {
    const wanted = category.toLowerCase()
    filtered = filtered.filter((m) => (m.category ?? '').toLowerCase() === wanted)
  }

  if (term) {
    const lower = term.toLowerCase()
    const normalized = normalizePartNumber(term)
    const scored: { match: PartMatch; rank: number }[] = []
    for (const match of filtered) {
      const keys = numberKeys(match)
      let rank: number
      if (keys.includes(normalized)) rank = 0
      else if (normalized.length >= 3 && keys.some((k) => k.includes(normalized))) rank = 1
      else if (haystack(match).includes(lower)) rank = 2
      else continue
      scored.push({ match, rank })
    }
    scored.sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.match.oemPartNumber ?? '').localeCompare(b.match.oemPartNumber ?? ''),
    )
    filtered = scored.map((s) => s.match)
  } else {
    filtered = [...filtered].sort((a, b) =>
      (a.oemPartNumber ?? a.description).localeCompare(b.oemPartNumber ?? b.description),
    )
  }

  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT)

  return {
    results: filtered.slice(0, limit),
    total:   filtered.length,
    manufacturers,
    categories,
    degraded,
  }
}

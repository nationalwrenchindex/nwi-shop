// SERVER-ONLY. Trailer reference lookup for /shop/tools/trailer-abs.
//
// Reads `hd_trailer_reference` LIVE on every request. That table is a global,
// anon-readable catalog shared with the NWI Suite project inside the same Supabase
// instance — NWI Shop is a reader and only a reader. Nothing in this file writes,
// updates, deletes or seeds it, and Suite's seed route (which deletes the whole table
// and re-inserts it) is deliberately not ported: running it from Shop would destroy the
// catalog Suite depends on.
//
// DROPPED ON PURPOSE — the parts lookup. Suite's trailer ABS route also queries
// `hd_parts_reference` behind a double gate (an ILIKE on ABS-ish part functions, then an
// ABS-token / not-reefer-token test in code). Its own comment records both the reason it
// exists and the reason it is useless: that table holds ~950 rows of Thermo King and
// Carrier reefer parts and ZERO trailer parts, so the two gates combined return an empty
// array on every single request. It is dead weight that reads like a feature, so it is
// not ported here. If real trailer ABS parts ever land in that catalog, add the lookup
// then — and keep the not-reefer gate, because matching an ABS fault on the word
// "sensor" would put a reefer discharge temperature sensor on screen as the suggested
// fix for a wheel speed sensor fault on a brake system. A tech would order it.
//
// The categories, row shape and free-text matcher live in ./reference-categories so the
// client browser can share them without pulling next/headers into the bundle.

import { createClient } from '@/lib/supabase/server'
import { ABS_ROWS } from './abs-codes'
import { AIR_BRAKE_ROWS } from './air-brakes'
import { SLACK_ADJUSTER_ROWS } from './slack-adjusters'
import { WIRING_TORQUE_ROWS } from './wiring-torque'
import {
  CATEGORY_SYSTEMS,
  matchesTrailerNeedle,
  type ReferenceCategory,
  type ReferenceSource,
  type TrailerReferenceEntry,
} from './reference-categories'
import type { TrailerReferenceRow } from './types'

export {
  CATEGORY_LABELS,
  CATEGORY_SYSTEMS,
  REFERENCE_CATEGORIES,
  isReferenceCategory,
} from './reference-categories'
export type {
  ReferenceCategory,
  ReferenceSource,
  TrailerReferenceEntry,
} from './reference-categories'

export interface ReferenceResult {
  entries:   TrailerReferenceEntry[]
  source:    ReferenceSource
  /** False only when the shared catalog table does not exist in this project. */
  available: boolean
}

// Postgres 42P01 = relation does not exist. PGRST205/PGRST202 = PostgREST cannot see the
// table in its schema cache. All three mean "the shared catalog is not provisioned here",
// which is a not-yet state rather than a failure. Any other error is real and is allowed
// to surface.
const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205', 'PGRST202'])

const COLUMNS = 'id, system, component, description, value, units, notes, manufacturer'

/** Every ported row, in the order the four modules are read on screen. */
const BUNDLED_ROWS: readonly TrailerReferenceRow[] = [
  ...AIR_BRAKE_ROWS,
  ...SLACK_ADJUSTER_ROWS,
  ...ABS_ROWS,
  ...WIRING_TORQUE_ROWS,
]

/**
 * `q` is interpolated into a PostgREST or= filter, where a comma, paren or dot is read as
 * filter syntax rather than as text. Strip the structural characters and the LIKE
 * wildcards so a needle can only ever widen into a plain substring match.
 */
export function sanitizeNeedle(raw: string): string {
  return raw.replace(/[,()*%_\\"']/g, ' ').replace(/\s+/g, ' ').trim()
}

function bundled(category: ReferenceCategory | null, needle: string): TrailerReferenceEntry[] {
  const systems = category ? CATEGORY_SYSTEMS[category] : null
  return BUNDLED_ROWS
    .filter((row) => (systems ? systems.includes(row.system) : true))
    .filter((row) => matchesTrailerNeedle(row, needle))
    .map((row) => ({ ...row, id: null }))
}

/**
 * The one lookup both the API route and the page use. Falls back to the ported rows when
 * the shared catalog is not provisioned, so a tech under a trailer gets specs either way
 * — and the caller is told which it got, so the UI can say so.
 */
export async function lookupTrailerReference(
  category: ReferenceCategory | null,
  rawQuery: string,
  limit: number | null = null,
): Promise<ReferenceResult> {
  const needle = sanitizeNeedle(rawQuery)
  const supabase = await createClient()

  let query = supabase
    .from('hd_trailer_reference')
    .select(COLUMNS)
    .order('system')
    .order('component')

  if (category) query = query.in('system', [...CATEGORY_SYSTEMS[category]])

  // One ilike per searchable column, OR'd. `system` is included so "abs" or "torque"
  // finds the whole system even when neither the component nor the description repeats
  // the word.
  if (needle) {
    query = query.or(
      [
        `system.ilike.%${needle}%`,
        `component.ilike.%${needle}%`,
        `description.ilike.%${needle}%`,
      ].join(','),
    )
  }

  if (limit !== null) query = query.limit(limit)

  const { data, error } = await query.returns<TrailerReferenceEntry[]>()

  if (error) {
    if (TABLE_MISSING_CODES.has(error.code)) {
      const rows = bundled(category, needle)
      return {
        entries:   limit === null ? rows : rows.slice(0, limit),
        source:    'bundled',
        available: false,
      }
    }
    throw new Error(error.message)
  }

  return { entries: data ?? [], source: 'live', available: true }
}

// Client-safe half of the trailer reference contract: the four categories, how they map
// onto the seven stored systems, and the row shape.
//
// Split out from ./reference on purpose. That module reaches for the server Supabase
// client (next/headers), so a Client Component cannot import it — and the reference
// browser needs these constants to filter rows in the browser. Nothing here touches the
// database or imports the bundled row data, so it costs the client only these few
// hundred bytes.

import type { TrailerReferenceRow, TrailerSystem } from './types'

/** The four filter buttons the tech sees, in the order they are shown. */
export const REFERENCE_CATEGORIES = [
  'air_brakes',
  'slack_adjusters',
  'abs',
  'wiring',
] as const

export type ReferenceCategory = (typeof REFERENCE_CATEGORIES)[number]

export function isReferenceCategory(value: unknown): value is ReferenceCategory {
  return typeof value === 'string' && (REFERENCE_CATEGORIES as readonly string[]).includes(value)
}

/**
 * Four categories over seven stored systems. The pairings are how a tech thinks about
 * the work, not how the table is keyed: chambers are part of the air brake job, shoes
 * and drums come off with the slack adjuster, and the J560 pin-out and the fastener
 * torques are read together when a harness is chased.
 */
export const CATEGORY_SYSTEMS: Readonly<Record<ReferenceCategory, readonly TrailerSystem[]>> = {
  air_brakes:      ['Air Brakes', 'Brake Chambers'],
  slack_adjusters: ['Slack Adjusters', 'Brake Shoes & Drums'],
  abs:             ['ABS'],
  wiring:          ['Electrical', 'Torque Specs'],
}

export const CATEGORY_LABELS: Readonly<Record<ReferenceCategory, string>> = {
  air_brakes:      'Air Brakes & Chambers',
  slack_adjusters: 'Slack Adjusters, Shoes & Drums',
  abs:             'ABS Codes & Components',
  wiring:          'Wiring, J560 & Torque',
}

export interface TrailerReferenceEntry extends TrailerReferenceRow {
  /** Row id from the shared catalog. null on a bundled row — there is no DB row behind it. */
  id: string | null
}

/**
 * Where the rows on screen came from.
 *   live     — read from hd_trailer_reference this request.
 *   bundled  — the catalog table is not reachable in this Supabase project, so the rows
 *              ported into lib/shop/trailer/*.ts were served instead. Same content as
 *              source, but not live; the UI says so rather than pretending.
 */
export type ReferenceSource = 'live' | 'bundled'

/** Free-text match used on the client. The server does the same match in SQL. */
export function matchesTrailerNeedle(row: TrailerReferenceRow, needle: string): boolean {
  if (!needle) return true
  const hay = `${row.system} ${row.component} ${row.description} ${row.notes ?? ''}`.toLowerCase()
  return hay.includes(needle.toLowerCase())
}

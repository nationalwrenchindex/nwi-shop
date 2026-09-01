// Shared shapes for the two inspection families. DOT and aerial live in ONE
// table (shop_inspections, migration 009), so they get ONE set of types here:
// a form is a list of numbered sections, each a list of items, and an answer is
// a verdict plus a note. The 19 CVSA categories and the three aerial cadences
// are both expressed in that shape, which is what lets result.ts derive a
// verdict for either family with one code path.

export type InspectionType = 'dot' | 'aerial'

/** Aerial only. A DOT row must carry `null` — the DB check constraint enforces it. */
export type AerialCadence = 'pre_use' | 'frequent' | 'annual'

export type ItemVerdict = 'pass' | 'fail' | 'na'

/** `''` is unanswered. Items start blank so the tech must actively choose. */
export type ItemAnswer = ItemVerdict | ''

/** The row-level verdict. There is no 'na' overall — a document says pass or fail. */
export type InspectionOutcome = 'pass' | 'fail'

export interface InspectionItem {
  id:    string
  label: string
  /**
   * Failing one of these puts the unit out of service — 49 CFR 396.9 for DOT,
   * OSHA 1926.453 for aerial. The write path refuses the record unless
   * `removed_from_service` is confirmed.
   */
  safetyCritical?: boolean
}

export interface InspectionSection {
  id:    string
  num:   number
  label: string
  items: InspectionItem[]
}

export interface InspectionFormDef {
  type:     InspectionType
  /** null for DOT; the cadence for aerial. */
  cadence:  AerialCadence | null
  title:    string
  /** Regulatory citation printed on the report. */
  citation: string
  /** One line stating how often this inspection is required, and by whom. */
  requirement: string
  /** Annual aerial (A92.20) needs an inspector credential; pre-use does not. */
  requiresInspectorCert: boolean
  sections: InspectionSection[]
}

/**
 * One answered checklist line as stored in `shop_inspections.items`.
 *
 * The column defaults to a jsonb ARRAY, so the stored shape is a flat list
 * rather than NWI Suite's nested object keyed by category. Flat survives a
 * checklist revision: an item removed from the form later still reads back with
 * its label intact, because the label travels with the answer.
 */
export interface InspectionItemRecord {
  section_id: string
  item_id:    string
  label:      string
  result:     ItemVerdict
  notes:      string
}

/** One failed line, as stored in `shop_inspections.deficiencies`. */
export interface InspectionDeficiency {
  section_id:      string
  section_label:   string
  item_id:         string
  label:           string
  notes:           string
  safety_critical: boolean
}

/** Answers held in form state while the checklist is being filled in. */
export type InspectionAnswers = Record<
  string,
  Record<string, { result: ItemAnswer; notes: string }>
>

/**
 * A row of `shop_inspections`. Not in @/lib/types because that module is the
 * shared contract across all six build areas and this table belongs to one.
 */
export interface ShopInspection {
  id:                    string
  shop_id:               string
  type:                  InspectionType
  cadence:               AerialCadence | null
  job_id:                string | null
  vehicle_id:            string | null
  customer_id:           string | null
  unit_number:           string | null
  inspector_tech_id:     string | null
  inspector_name:        string
  inspector_cert_number: string | null
  result:                InspectionOutcome | null
  items:                 InspectionItemRecord[]
  deficiencies:          InspectionDeficiency[]
  violations:            string | null
  removed_from_service:  boolean
  carrier_name:          string | null
  carrier_address:       string | null
  license_plate:         string | null
  odometer:              number | null
  signature_data:        string | null
  signed_at:             string | null
  locked:                boolean
  locked_at:             string | null
  created_at:            string
}

export const INSPECTION_TYPES: readonly InspectionType[] = ['dot', 'aerial'] as const
export const AERIAL_CADENCES: readonly AerialCadence[] = ['pre_use', 'frequent', 'annual'] as const

export function isInspectionType(value: unknown): value is InspectionType {
  return value === 'dot' || value === 'aerial'
}

export function isAerialCadence(value: unknown): value is AerialCadence {
  return value === 'pre_use' || value === 'frequent' || value === 'annual'
}

export function isItemVerdict(value: unknown): value is ItemVerdict {
  return value === 'pass' || value === 'fail' || value === 'na'
}

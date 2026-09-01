// The pure verdict engine, shared by DOT and aerial.
//
// Everything here is a function of (form definition, answers). Nothing reads the
// database and nothing is server-only, so the browser can show the tech the same
// verdict the server is about to store — and the server can recompute it from
// scratch instead of trusting what the browser sent.
//
// WHY THE SERVER RE-DERIVES. NWI Suite's aerial route recomputed the result from
// the raw items; its DOT route trusted the client for `overall_result`. That is a
// signed compliance document whose pass/fail can be set by editing a POST body.
// Both families go through `deriveInspection()` here, on every write.

import { DOT_FORM } from './dot-categories'
import { AERIAL_FORMS } from './aerial-forms'
import {
  isAerialCadence,
  isItemVerdict,
  type AerialCadence,
  type InspectionAnswers,
  type InspectionDeficiency,
  type InspectionFormDef,
  type InspectionItem,
  type InspectionItemRecord,
  type InspectionOutcome,
  type InspectionType,
  type ItemVerdict,
} from './types'

/** Resolves the form definition for a stored row, or null when the pair is invalid. */
export function formFor(
  type: InspectionType,
  cadence: AerialCadence | null,
): InspectionFormDef | null {
  if (type === 'dot') return cadence === null ? DOT_FORM : null
  return cadence && isAerialCadence(cadence) ? AERIAL_FORMS[cadence] : null
}

/** Every item across every section, flattened, each carrying its section. */
export function allItems(
  def: InspectionFormDef,
): Array<InspectionItem & { sectionId: string; sectionLabel: string }> {
  return def.sections.flatMap((section) =>
    section.items.map((item) => ({
      ...item,
      sectionId:    section.id,
      sectionLabel: section.label,
    })),
  )
}

/** A blank answer sheet — every item present and unanswered. */
export function emptyAnswers(def: InspectionFormDef): InspectionAnswers {
  const answers: InspectionAnswers = {}
  for (const section of def.sections) {
    answers[section.id] = Object.fromEntries(
      section.items.map((item) => [item.id, { result: '' as const, notes: '' }]),
    )
  }
  return answers
}

/** Items still unanswered. Submission is blocked while this is above zero. */
export function unansweredCount(def: InspectionFormDef, answers: InspectionAnswers): number {
  return allItems(def).filter((item) => {
    const state = answers[item.sectionId]?.[item.id]
    return !state || state.result === ''
  }).length
}

/**
 * A section's verdict, for the collapsed header. Failed if any answered item
 * failed; N/A only when every answered item is N/A.
 */
export function sectionVerdict(
  def: InspectionFormDef,
  sectionId: string,
  answers: InspectionAnswers,
): ItemVerdict {
  const section = def.sections.find((s) => s.id === sectionId)
  const results = (section?.items ?? []).map((item) => answers[sectionId]?.[item.id]?.result)
  if (results.some((r) => r === 'fail')) return 'fail'
  if (results.length > 0 && results.every((r) => r === 'na')) return 'na'
  return 'pass'
}

/** Failed lines, with their labels baked in so the record needs no re-derivation to print. */
export function collectDeficiencies(
  def: InspectionFormDef,
  answers: InspectionAnswers,
): InspectionDeficiency[] {
  const out: InspectionDeficiency[] = []
  for (const section of def.sections) {
    for (const item of section.items) {
      const state = answers[section.id]?.[item.id]
      if (state?.result !== 'fail') continue
      out.push({
        section_id:      section.id,
        section_label:   section.label,
        item_id:         item.id,
        label:           item.label,
        notes:           state.notes ?? '',
        safety_critical: item.safetyCritical === true,
      })
    }
  }
  return out
}

/**
 * A single failure fails the inspection. There is no partial pass on either
 * family: a truck with a defective item is not roadworthy and an aerial lift
 * with one is not compliant.
 */
export function overallResult(deficiencies: InspectionDeficiency[]): InspectionOutcome {
  return deficiencies.length > 0 ? 'fail' : 'pass'
}

export function hasCriticalDeficiency(deficiencies: InspectionDeficiency[]): boolean {
  return deficiencies.some((d) => d.safety_critical)
}

/** The flat answer list written to `shop_inspections.items`. */
export function toItemRecords(
  def: InspectionFormDef,
  answers: InspectionAnswers,
): InspectionItemRecord[] {
  return allItems(def)
    .map((item) => {
      const state = answers[item.sectionId]?.[item.id]
      if (!state || !isItemVerdict(state.result)) return null
      return {
        section_id: item.sectionId,
        item_id:    item.id,
        label:      item.label,
        result:     state.result,
        notes:      state.notes ?? '',
      }
    })
    .filter((record): record is InspectionItemRecord => record !== null)
}

/** Rebuilds an answer sheet from a stored row, for the read-only report view. */
export function answersFromRecords(records: InspectionItemRecord[]): InspectionAnswers {
  const answers: InspectionAnswers = {}
  for (const record of records) {
    const section = (answers[record.section_id] ??= {})
    section[record.item_id] = { result: record.result, notes: record.notes ?? '' }
  }
  return answers
}

/**
 * Parses whatever arrived in a request body into an answer sheet, keeping only
 * items the form definition actually contains. Anything the client invented is
 * dropped rather than trusted — this is the boundary between a POST body and a
 * compliance record.
 */
export function parseAnswers(def: InspectionFormDef, raw: unknown): InspectionAnswers {
  const answers = emptyAnswers(def)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return answers

  const bySection = raw as Record<string, unknown>
  for (const section of def.sections) {
    const rawSection = bySection[section.id]
    if (!rawSection || typeof rawSection !== 'object' || Array.isArray(rawSection)) continue
    const byItem = rawSection as Record<string, unknown>

    for (const item of section.items) {
      const rawItem = byItem[item.id]
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue
      const state = rawItem as { result?: unknown; notes?: unknown }
      answers[section.id][item.id] = {
        result: isItemVerdict(state.result) ? state.result : '',
        // Notes are printed on the report; cap them so one field cannot be used
        // to smuggle a wall of text into a signed document.
        notes:  typeof state.notes === 'string' ? state.notes.trim().slice(0, 1000) : '',
      }
    }
  }
  return answers
}

export interface DerivedInspection {
  items:        InspectionItemRecord[]
  deficiencies: InspectionDeficiency[]
  result:       InspectionOutcome
  /** Plain-text summary for the `violations` column. Null when nothing failed. */
  violations:   string | null
  unanswered:   number
  critical:     boolean
}

/**
 * The single derivation used by the write path. Callers never compute `result`
 * themselves and never accept one from a client.
 */
export function deriveInspection(
  def: InspectionFormDef,
  answers: InspectionAnswers,
): DerivedInspection {
  const deficiencies = collectDeficiencies(def, answers)
  return {
    items:        toItemRecords(def, answers),
    deficiencies,
    result:       overallResult(deficiencies),
    violations:   summariseViolations(deficiencies),
    unanswered:   unansweredCount(def, answers),
    critical:     hasCriticalDeficiency(deficiencies),
  }
}

/**
 * `shop_inspections.violations` is a TEXT column, not jsonb — the structured list
 * lives in `deficiencies`. This is the one-line-per-violation summary an auditor
 * reads without opening the JSON.
 */
export function summariseViolations(deficiencies: InspectionDeficiency[]): string | null {
  if (deficiencies.length === 0) return null
  return deficiencies
    .map((d) => {
      const flag = d.safety_critical ? ' [SAFETY CRITICAL]' : ''
      const note = d.notes ? ` — ${d.notes}` : ''
      return `${d.section_label}: ${d.label}${flag}${note}`
    })
    .join('\n')
}

/** A signature is a PNG data URL from the canvas pad. Anything else is refused. */
const SIGNATURE_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/
/** ~1.5 MB of base64. A canvas signature is a few tens of KB; this is only a ceiling. */
const SIGNATURE_MAX_CHARS = 1_500_000

export function isValidSignature(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 128 &&
    value.length <= SIGNATURE_MAX_CHARS &&
    SIGNATURE_PATTERN.test(value)
  )
}

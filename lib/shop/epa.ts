// EPA Section 608 refrigerant log — domain logic.
//
// 40 CFR Part 82 requires a technician who opens a refrigerant circuit to record
// what happened to the refrigerant: how much went in, how much came out, how much
// was evacuated, and who — by certification number — did it. The log is the
// shop's answer when an inspector asks, so the only two things this module has to
// get right are the four recognised actions and the arithmetic on the totals.
//
// NWI Suite shipped this screen with no write path at all: its "+ Log Entry"
// button opened a panel reading "Full EPA log entry form coming in the next
// update", and rows could only be inserted by hand in the database. The entry
// form and POST route in NWI Shop are the reason this module exists.
//
// This file is free of server-only imports so the entry form can share the same
// validation the API route runs.

/** The four events the regulation recognises. `action` carries the direction. */
export type EpaAction = 'added' | 'recovered' | 'evacuated' | 'leak_test'

export const EPA_ACTIONS: readonly EpaAction[] = [
  'added',
  'recovered',
  'evacuated',
  'leak_test',
] as const

export const EPA_ACTION_LABELS: Record<EpaAction, string> = {
  added:     'Added / charged',
  recovered: 'Recovered',
  evacuated: 'Evacuated',
  leak_test: 'Leak test',
}

/** One-line explanation shown beside the action selector. */
export const EPA_ACTION_HELP: Record<EpaAction, string> = {
  added:     'Refrigerant charged into the system from a cylinder.',
  recovered: 'Refrigerant pulled out of the system into a recovery cylinder.',
  evacuated: 'System evacuated to vacuum after recovery.',
  leak_test: 'Leak test performed. Pounds is normally 0.',
}

/** Tailwind classes for the action pill. High contrast on a bright tablet. */
export const EPA_ACTION_PILL: Record<EpaAction, string> = {
  added:     'bg-sky-100 text-sky-900 ring-sky-300',
  recovered: 'bg-amber-100 text-amber-900 ring-amber-300',
  evacuated: 'bg-violet-100 text-violet-900 ring-violet-300',
  leak_test: 'bg-slate-200 text-slate-800 ring-slate-300',
}

export function isEpaAction(value: unknown): value is EpaAction {
  return typeof value === 'string' && (EPA_ACTIONS as readonly string[]).includes(value)
}

/**
 * Suggestions only. `refrigerant_type` is free text in the database on purpose —
 * the list is set by regulation and by what the supplier will sell, and a fixed
 * enum would mean a migration every time a shop stocks something new.
 */
export const COMMON_REFRIGERANTS: readonly string[] = [
  'R-134a',
  'R-1234yf',
  'R-404A',
  'R-452A',
  'R-410A',
  'R-513A',
  'R-22',
] as const

/** A row of `shop_epa_log` (migration 010). */
export interface ShopEpaLogEntry {
  id:                        string
  shop_id:                   string
  job_id:                    string | null
  vehicle_id:                string | null
  tech_id:                   string | null
  log_date:                  string
  refrigerant_type:          string
  action:                    EpaAction
  pounds:                    number
  reason:                    string | null
  tech_certification_number: string | null
  notes:                     string | null
  created_at:                string
}

/** An entry with the labels the table needs, resolved by id lookup rather than an embed. */
export interface EpaLogRow extends ShopEpaLogEntry {
  vehicle_label: string | null
  tech_name:     string | null
  job_number:    number | null
}

/**
 * The shop's default EPA 608 certification number, so a tech does not retype it
 * on every entry.
 *
 * Read off the profile row defensively: `epa_cert_number` arrives in a later
 * migration than the one that created this log, and ShopProfile in @/lib/types is
 * a shared contract this feature does not get to edit. A profile without the
 * column simply yields a blank field.
 */
export function shopEpaCertNumber(shop: object): string {
  const extended = shop as { epa_cert_number?: unknown }
  return typeof extended.epa_cert_number === 'string' ? extended.epa_cert_number : ''
}

// ---------------------------------------------------------------------------
// Validation, shared by the entry form and the POST route
// ---------------------------------------------------------------------------

/** Trim, collapse internal whitespace and cap. Refrigerant names are case-sensitive
 *  in practice (R-134a, not R-134A), so the case the tech typed is preserved. */
export function normaliseRefrigerant(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 40)
}

/** Pounds is read off a scale, so fractions matter — but a negative reading does not. */
export function isValidPounds(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 10_000
}

/** ISO date (YYYY-MM-DD) that is a real day and not in the future. */
export function isValidLogDate(value: string, today = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  // Back-dating is normal — the entry is routinely typed in after the fact.
  // Forward-dating is not: it would put refrigerant on a day that has not happened.
  return value <= toDateInput(today)
}

/** `YYYY-MM-DD` in the local timezone, for a date input's default value. */
export function toDateInput(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface RefrigerantTotals {
  refrigerant: string
  entries:     number
  added:       number
  recovered:   number
  evacuated:   number
  leakTests:   number
  /**
   * Added minus recovered. Positive means more refrigerant went into vehicles
   * than came back out of them over the period — which is the number an auditor
   * compares against cylinder purchases.
   */
  net:         number
}

/**
 * Totals per refrigerant type, heaviest first. Sums in one pass because the log
 * is read whole: there is no server-side aggregate and there does not need to be
 * until a shop has more entries than a page can hold.
 */
export function totalsByRefrigerant(entries: ShopEpaLogEntry[]): RefrigerantTotals[] {
  const byType = new Map<string, RefrigerantTotals>()

  for (const entry of entries) {
    const key = entry.refrigerant_type || 'Unspecified'
    const totals = byType.get(key) ?? {
      refrigerant: key,
      entries:     0,
      added:       0,
      recovered:   0,
      evacuated:   0,
      leakTests:   0,
      net:         0,
    }

    const pounds = Number(entry.pounds) || 0
    totals.entries += 1
    if (entry.action === 'added')     totals.added += pounds
    if (entry.action === 'recovered') totals.recovered += pounds
    if (entry.action === 'evacuated') totals.evacuated += pounds
    if (entry.action === 'leak_test') totals.leakTests += 1
    totals.net = totals.added - totals.recovered

    byType.set(key, totals)
  }

  return [...byType.values()].sort(
    (a, b) => b.added + b.recovered - (a.added + a.recovered),
  )
}

export function totalPounds(entries: ShopEpaLogEntry[]): number {
  return entries.reduce((sum, entry) => sum + (Number(entry.pounds) || 0), 0)
}

/**
 * Two decimals, which is what a recovery scale reads. The database column is
 * plain `numeric` so nothing is rounded on the way in — only on the way to a
 * screen.
 */
export function formatPounds(value: number): string {
  return `${(Number(value) || 0).toFixed(2)} lbs`
}

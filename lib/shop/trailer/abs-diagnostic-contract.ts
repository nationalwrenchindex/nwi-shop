// The wire contract between /api/shop/tools/trailer-abs/diagnostic and the page that
// calls it, plus the safe content the route falls back to when it will not commit to a
// diagnosis. Pure data and pure functions — no server imports — so the client component
// can render the same fallback the route returns without a second copy of the words.
//
// SAFETY NOTE, and it is the reason this file exists at all: nothing here asserts what a
// blink code means. Blink code tables differ between ECU generations, so the only safe
// instruction when we are unsure is "read the decal on the ECU in front of you" — never
// "a 1-1 means X". See abs-codes.ts, which documents the same policy for the reference
// rows, and abs-labor.ts, which documents why no number here is ever model-authored.

import type { ABSLaborEntry } from './abs-labor'

export const ABS_MANUFACTURERS = ['wabco', 'bendix', 'haldex'] as const
export type ABSManufacturer = (typeof ABS_MANUFACTURERS)[number]

export const ABS_MANUFACTURER_LABELS: Readonly<Record<ABSManufacturer, string>> = {
  wabco:  'WABCO (ZF)',
  bendix: 'Bendix',
  haldex: 'Haldex',
}

export function isABSManufacturer(v: unknown): v is ABSManufacturer {
  return (
    typeof v === 'string' &&
    (ABS_MANUFACTURERS as readonly string[]).includes(v.trim().toLowerCase())
  )
}

export interface ABSDiagnosticResponse {
  fault_description:      string
  diagnostic_steps:       string[]
  specs_to_check:         string[]
  tools_needed:           string[]
  clarification_needed:   boolean
  clarification_question: string | null
  labor_estimate:         ABSLaborEntry | null
}

/** What to tell the tech to read off the ECU when we will not commit to a diagnosis. */
export const ECU_HOUSING_HINT: Readonly<Record<ABSManufacturer, string>> = {
  wabco:  'the ECU/valve assembly part number stamped on the WABCO (ZF) housing, and the TEBS generation printed on the housing decal',
  bendix: 'the Bendix ECU part number and model name on the housing decal, and the blink code chart printed on the ECU or inside its cover',
  haldex: 'the Haldex ECU part number and generation on the housing decal — Gen 4 and Gen 5 read different blink code tables — and the blink code decal on the ECU itself',
}

export function absSafeSteps(manufacturer: ABSManufacturer): string[] {
  return [
    'Do not replace any ABS component based on this screen alone.',
    `Read the blink code decal on the ABS ECU housing and record ${ECU_HOUSING_HINT[manufacturer]}.`,
    'Look the code up in the manufacturer service literature for that exact ECU part number. A chart for a different ECU generation will point you at the wrong wheel end.',
    'Before chasing any component, verify ABS power and ground at the ECU and confirm the ABS circuit through the seven-way connector is intact and free of corrosion.',
    'After any ABS repair: clear codes, cycle power, confirm the trailer ABS lamp completes its self-check and goes out, and road test above 6 mph so the ECU can see all wheel speed signals.',
  ]
}

/**
 * The documented fallback. Returned with HTTP 200 — not a 500 — because a stack trace is
 * useless to a tech under a trailer and an error page reads as "the app is broken" rather
 * than "here is what to do instead". It contains no diagnosis, and it never will.
 */
export function absFallbackResponse(
  manufacturer: ABSManufacturer,
  reason: string,
): ABSDiagnosticResponse {
  return {
    fault_description:      `The AI diagnostic is unavailable right now (${reason}), so no fault has been identified. Nothing on this screen is a diagnosis — diagnose this fault from the ECU decal and the manufacturer literature.`,
    diagnostic_steps:       absSafeSteps(manufacturer),
    specs_to_check:         [],
    tools_needed:           [],
    clarification_needed:   true,
    clarification_question: `Once you have read ${ECU_HOUSING_HINT[manufacturer]}, enter the ECU generation and the exact blink code and try again.`,
    labor_estimate:         null,
  }
}

/**
 * The disclaimer that must appear on every rendered diagnostic. Trailer brakes are a
 * federally mandated life-safety system; AI output is a starting point for diagnosis and
 * is never a substitute for the manufacturer service manual.
 */
export const ABS_AI_DISCLAIMER =
  'AI-assisted diagnosis. Trailer brakes are a federally mandated (FMVSS 121) life-safety system — verify everything on this screen against the manufacturer service manual for this exact ECU part number before you touch the brakes or return the trailer to service.'

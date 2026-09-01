// QuickWrench LD — the diagnostic engine, ported from the National Wrench Index
// suite (src/app/api/quickwrench/* and src/lib/tech-guide.ts).
//
// This module is deliberately PURE: types, system prompts, prompt builders and
// tolerant JSON parsers. It imports nothing from `next`, Supabase or the Gemini
// client, so a Client Component may import the types and the plain-text
// formatter without dragging server code into the browser bundle.
//
// The Supabase cache read lives in ./ld-cache (server only) and the NHTSA
// lookups in ./ld-nhtsa.
//
// =====================================================================
// SAFETY. Everything this file shapes is AI-generated and is read by a
// person standing at a real vehicle. Nothing here is manufacturer data.
// Every surface that renders it MUST show AI_DISCLAIMER and the grounding
// citations. Never present a torque spec, a capacity or a procedure from
// this engine as if it came from the service manual.
// =====================================================================

// ---------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------

/** Ported from NWI Suite `QWVehicle` (src/types/quickwrench.ts). */
export interface LdVehicle {
  vin:                string
  year:               string
  make:               string
  model:              string
  engine:             string
  trim?:              string
  driveType?:         string
  transmissionStyle?: string
  fuelType?:          string
  bodyClass?:         string
}

/** The subset every lookup needs. VIN decode fills it; the tech may type it. */
export interface LdVehicleInput {
  year:    string
  make:    string
  model:   string
  engine?: string
  trim?:   string
}

export function vehicleLabel(v: Partial<LdVehicleInput>): string {
  return [v.year, v.make, v.model].filter(Boolean).join(' ') || 'an unspecified vehicle'
}

// ---------------------------------------------------------------------------
// Diagnostic result
// ---------------------------------------------------------------------------

export type LdSeverity = 'low' | 'moderate' | 'high' | 'critical' | ''

/**
 * Structured diagnostic. Every field is always present after
 * `normalizeDiagnostic`, so the UI never has to guard for a missing array.
 */
export interface LdDiagnostic {
  code:                 string
  name:                 string
  category:             string
  symptoms:             string[]
  severity:             LdSeverity
  severity_description: string
  common_causes:        string[]
  related_codes:        string[]
  diagnostic_order:     string[]
  repair_steps:         string[]
  suggested_repair:     string
  parts_needed:         string[]
  special_tools:        string
  labor_estimate:       string
  safety_warnings:      string
  /** Grounding sources Gemini used. Surfaced with the answer, never hidden. */
  citations:            string[]
}

export interface LdDiagnoseResponse {
  result: LdDiagnostic
  /** 'cache' when it came from NWI Suite's shared cache, else the model. */
  source: 'cache' | 'gemini_web_search'
  cached: boolean
}

// ---------------------------------------------------------------------------
// Specs + guide
// ---------------------------------------------------------------------------

export interface LdTireSpecs {
  tire_size_front:         string | null
  tire_size_rear:          string | null
  lug_torque_lb_ft:        number | null
  bolt_pattern:            string | null
  tire_pressure_front_psi: number | null
  tire_pressure_rear_psi:  number | null
  load_speed_rating:       string | null
  wheel_size:              string | null
}

export interface LdFluidSpecs {
  oil:            string | null
  coolant:        string | null
  transmission:   string | null
  brake:          string | null
  power_steering: string | null
  notes:          string | null
}

export interface LdTorqueSpec {
  part: string
  spec: string
}

/**
 * Repair guide. NWI Suite's TechGuide carried demo supplier/retail pricing for
 * its own quoting flow; NWI Shop quotes from real inventory and the shop's own
 * labor rate, so parts here are names and quantities only — inventing a cost a
 * shop would bill against is worse than showing none.
 */
export interface LdGuidePart {
  name: string
  qty:  number
}

export interface LdTechGuide {
  torque:  LdTorqueSpec[]
  steps:   string[]
  tools:   string[]
  warning: string
  hours:   number
  parts:   LdGuidePart[]
}

// ---------------------------------------------------------------------------
// Disclaimers — ported from the NWI Suite QuickWrench surfaces.
// ---------------------------------------------------------------------------

export const AI_DISCLAIMER =
  'AI-generated from web sources — not manufacturer data. Verify every torque ' +
  'spec, capacity, part number and procedure against the service manual for ' +
  'this exact vehicle before you turn a wrench.'

export const NHTSA_DISCLAIMER =
  'Source: NHTSA public data. Recall and complaint records are campaign-level ' +
  'or owner-reported and may be incomplete — confirm open recalls with the ' +
  'dealer using the VIN.'

// ---------------------------------------------------------------------------
// System prompts — ported in substance from NWI Suite so answers that were
// proven in the field behave identically here.
// ---------------------------------------------------------------------------

export const DTC_SYSTEM_PROMPT = `You are an expert automotive diagnostic technician. Return ONLY valid JSON — no markdown, no backticks, no preamble. First character must be {, last must be }.

Return a JSON object with these exact fields:
- code: the DTC code
- name: official code name
- category: system category (e.g. Emissions/Catalyst)
- symptoms: array of symptom strings
- severity: one of 'low', 'moderate', 'high', 'critical'
- severity_description: one sentence on driveability impact
- common_causes: array of cause strings, vehicle-specific, ordered by field frequency
- related_codes: array of related DTC code strings
- diagnostic_order: array of diagnostic step strings with exact specs (voltages, resistances, sensor ranges)
- repair_steps: array of step-by-step repair procedure strings in the order a tech would perform them. These are REPAIR actions (remove, replace, torque, install) NOT diagnostic actions. Always include:
  * Torque specifications where applicable (e.g. 'Torque manifold bolts to 18 ft-lbs in sequence')
  * Special tool requirements per step
  * Safety notes per step (e.g. 'Allow exhaust to cool before handling')
  * Part numbers for components being replaced
  * Whether engine must be cold, warm, or off for each step
- suggested_repair: field-realistic repair recommendation
- parts_needed: array of parts typically needed for this repair. REQUIRED — never return an empty array. Always include at minimum the primary failed component with OEM part number, and any sensors or gaskets typically replaced during this repair. Format each entry as: 'Part Name — OEM Part# XXXXX (Aftermarket: Brand XXXXX) Est. $XX-$XX'. If exact part numbers vary by build, state the part name and note 'verify part number with VIN at dealer'
- special_tools: string listing tools needed or 'None beyond standard hand tools and multimeter'
- labor_estimate: string with a shop time estimate
- safety_warnings: string with any safety precautions

TECHNICAL SPECIFICITY — MANDATORY:
All diagnostic steps must include exact voltage specs, resistance values, and sensor output ranges. Include OEM part numbers. Be vehicle-specific — not generic.

HONESTY — MANDATORY:
If a specification is not verifiable for this exact vehicle, say so in that field rather than inventing a number. A technician is acting on this.`

export const SYMPTOM_SYSTEM_ADDITION = `

When no DTC code is provided, diagnose based on the described symptom. Return the same JSON structure but:
- code: 'NO-CODE'
- name: summarize the symptom in 5 words or less
- Focus diagnostic_order on symptom-based diagnosis steps
- Include most likely DTC codes that could cause this symptom in related_codes[]
- suggested_repair should be especially detailed since there's no code to guide the diagnosis`

export const TIRE_SPECS_SYSTEM_PROMPT = `You are an expert automotive technician with access to OEM specification databases. Respond ONLY with raw JSON — no markdown, no backticks, no preamble. First character must be {, last must be }.

Schema (all fields required, use null if genuinely uncertain):
{"tire_size_front":"","tire_size_rear":"","lug_torque_lb_ft":0,"bolt_pattern":"","tire_pressure_front_psi":0,"tire_pressure_rear_psi":0,"load_speed_rating":"","wheel_size":""}

Rules:
- tire_size_front / tire_size_rear: OEM size string like "225/65R17". Same value for both if front = rear. null only if truly unknown.
- lug_torque_lb_ft: integer lb-ft (e.g. 140). null if unknown.
- bolt_pattern: metric format like "6x139.7" or "5x114.3". null if unknown.
- tire_pressure_front_psi / tire_pressure_rear_psi: integer PSI from door jamb spec. null if unknown.
- load_speed_rating: like "100H" or "XL 107V". null if unknown.
- wheel_size: like "17x7.5". null if unknown.
- Use null only if you are not confident — never guess. A wrong lug torque puts a wheel on the road.`

export const FLUID_SPECS_SYSTEM_PROMPT = `You are an automotive fluids specialist. Respond ONLY with raw JSON — no markdown, no backticks, no preamble. First character must be {, last must be }.

Schema (all fields required, use null if genuinely uncertain):
{"oil":"","coolant":"","transmission":"","brake":"","power_steering":"","notes":""}

Be specific to the exact vehicle year/make/model/engine. Use OEM-recommended specs. Keep each value to one concise phrase (e.g. "5W-30 Full Synthetic"). Notes field: one short sentence about any critical fluid considerations. Use null rather than guessing — the wrong transmission fluid destroys a transmission.`

export const TECH_GUIDE_SYSTEM_PROMPT = `You are an automotive technician. Respond ONLY with raw JSON — no markdown, no backticks, no preamble, no explanation after. First character must be { and last character must be }.

Schema (all fields required):
{"torque":[{"part":"","spec":""}],"steps":[""],"tools":[""],"warning":"","hours":1,"parts":[{"name":"","qty":1}]}

Limits: max 6 torque specs, max 12 steps, max 6 tools, 1 warning sentence, max 8 parts. Be concise and specific to this exact vehicle.

- torque: only specs you can state for THIS vehicle. Omit rather than guess.
- steps: the repair in the order a tech performs it, including whether the engine must be cold, warm or off.
- hours: realistic book time in decimal hours for a shop with a lift.
- parts: names and quantities only. Do NOT include prices — the shop prices from its own inventory.

TIRE SERVICE KNOWLEDGE:
- Tire size format: P265/70R17 → P=passenger, 265=width in mm, 70=aspect ratio %, R=radial, 17=rim diameter in inches. LT prefix = light truck.
- OEM tires: match the exact size, load index, and speed rating on the door jamb sticker.
- Lug nut torque is vehicle-specific — always torque to spec. Retorque after 50 miles.
- Never use petroleum-based bead lubricant.
- Direct TPMS sensors require programming and a relearn procedure after replacement.
- Always balance after tire replacement.`

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export function buildCodePrompt(
  code: string,
  vehicle: string,
  engine: string,
  displayMessage: string,
): string {
  return [
    `Diagnose DTC ${code} on a ${vehicle}`,
    engine         ? `Engine: ${engine}`                : '',
    displayMessage ? `Display shows: ${displayMessage}` : '',
    'Provide vehicle-specific diagnostic procedures, part numbers, and repair guidance for a shop technician.',
  ].filter(Boolean).join('\n')
}

export function buildSymptomPrompt(
  symptom: string,
  vehicle: string,
  engine: string,
): string {
  return [
    `Diagnose this symptom on a ${vehicle}: ${symptom}`,
    engine ? `Engine: ${engine}` : '',
    'No DTC code is available. Provide a symptom-based diagnosis, the most likely DTC codes, vehicle-specific diagnostic steps, part numbers, and repair guidance for a shop technician.',
  ].filter(Boolean).join('\n')
}

export function buildSpecPrompt(kind: 'tire' | 'fluid', vehicleDesc: string): string {
  return kind === 'tire'
    ? `Provide OEM tire specifications for a ${vehicleDesc}.`
    : `Vehicle: ${vehicleDesc}\nProvide OEM fluid specifications.`
}

export function buildTechGuidePrompt(vehicleDesc: string, job: string): string {
  return `Vehicle: ${vehicleDesc || 'Generic vehicle'}
Job: ${job}

Provide the complete technical guide for this specific vehicle and job.`
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const DTC_RE = /^[PBCU][0-9]{4}$/
export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i

export function isValidDtc(code: string): boolean {
  return DTC_RE.test(code.trim().toUpperCase())
}

export function isValidVin(vin: string): boolean {
  return VIN_RE.test(vin.trim())
}

// ---------------------------------------------------------------------------
// Tolerant JSON parsing. Gemini is asked for raw JSON and mostly complies; these
// recover the object when it wraps the answer in fences or prose.
// ---------------------------------------------------------------------------

const asStr = (v: unknown): string => (typeof v === 'string' ? v : '')

const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []

const asNumOrNull = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

const asStrOrNull = (v: unknown): string | null => {
  const s = asStr(v).trim()
  return s === '' || s.toLowerCase() === 'null' ? null : s
}

function stripFences(text: string): string {
  return text.replace(/```(?:json|JSON)?\s*/g, '').replace(/```/g, '').trim()
}

/** First `{` to last `}`. Cheap and correct for a single top-level object. */
export function parseJsonLoose(text: string): unknown | null {
  const cleaned = stripFences(text)
  const start = cleaned.indexOf('{')
  const end   = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Brace-matching extractor, string- and escape-aware. Used for the tech guide,
 * whose nested objects make "last closing brace" the wrong boundary when the
 * model appends prose containing a `}`.
 */
export function extractOutermostJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape)                  { escape = false; continue }
    if (ch === '\\' && inString) { escape = true;  continue }
    if (ch === '"')              { inString = !inString; continue }
    if (inString)                { continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

const SEVERITIES: LdSeverity[] = ['low', 'moderate', 'high', 'critical']

function asSeverity(v: unknown): LdSeverity {
  const s = asStr(v).toLowerCase().trim() as LdSeverity
  return SEVERITIES.includes(s) ? s : ''
}

/** Coerce loose model JSON into a fully-populated LdDiagnostic. */
export function normalizeDiagnostic(raw: unknown, citations: string[] = []): LdDiagnostic {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    code:                 asStr(o.code),
    name:                 asStr(o.name),
    category:             asStr(o.category),
    symptoms:             asStrArr(o.symptoms),
    severity:             asSeverity(o.severity),
    severity_description: asStr(o.severity_description),
    common_causes:        asStrArr(o.common_causes),
    related_codes:        asStrArr(o.related_codes),
    diagnostic_order:     asStrArr(o.diagnostic_order),
    repair_steps:         asStrArr(o.repair_steps),
    suggested_repair:     asStr(o.suggested_repair),
    parts_needed:         asStrArr(o.parts_needed),
    special_tools:        asStr(o.special_tools),
    labor_estimate:       asStr(o.labor_estimate),
    safety_warnings:      asStr(o.safety_warnings),
    citations,
  }
}

export function normalizeTireSpecs(raw: unknown): LdTireSpecs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    tire_size_front:         asStrOrNull(o.tire_size_front),
    tire_size_rear:          asStrOrNull(o.tire_size_rear),
    lug_torque_lb_ft:        asNumOrNull(o.lug_torque_lb_ft),
    bolt_pattern:            asStrOrNull(o.bolt_pattern),
    tire_pressure_front_psi: asNumOrNull(o.tire_pressure_front_psi),
    tire_pressure_rear_psi:  asNumOrNull(o.tire_pressure_rear_psi),
    load_speed_rating:       asStrOrNull(o.load_speed_rating),
    wheel_size:              asStrOrNull(o.wheel_size),
  }
}

export function normalizeFluidSpecs(raw: unknown): LdFluidSpecs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    oil:            asStrOrNull(o.oil),
    coolant:        asStrOrNull(o.coolant),
    transmission:   asStrOrNull(o.transmission),
    brake:          asStrOrNull(o.brake),
    power_steering: asStrOrNull(o.power_steering),
    notes:          asStrOrNull(o.notes),
  }
}

/**
 * Ported from NWI Suite `normaliseGuide`. Field names are matched loosely on
 * purpose: a response keyed `parts_needed` instead of `parts` used to be a total
 * loss, and a silently missing parts list is the most common way this call
 * degrades.
 */
export function normalizeTechGuide(raw: unknown): LdTechGuide {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const arr = (...keys: string[]): unknown[] => {
    for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[]
    return []
  }

  const torque: LdTorqueSpec[] = arr('torque', 'torque_specs')
    .map((t) => {
      const q = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
      const part = asStr(q.part) || asStr(q.name)
      const spec = asStr(q.spec) || asStr(q.value)
      return part && spec ? { part, spec } : null
    })
    .filter((t): t is LdTorqueSpec => t !== null)

  const parts: LdGuidePart[] = arr('parts', 'parts_needed', 'partsNeeded', 'required_parts')
    .map((p) => {
      if (typeof p === 'string') return p.trim() ? { name: p.trim(), qty: 1 } : null
      const q = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
      const name = asStr(q.name) || asStr(q.part)
      if (!name) return null
      return { name, qty: Number(q.qty ?? q.quantity ?? 1) || 1 }
    })
    .filter((p): p is LdGuidePart => p !== null)

  return {
    torque,
    steps:   arr('steps', 'repair_steps').filter((s): s is string => typeof s === 'string'),
    tools:   arr('tools').filter((s): s is string => typeof s === 'string'),
    warning: asStr(o.warning),
    hours:   Number(o.hours ?? o.labor_hours ?? 0) || 0,
    parts,
  }
}

/** Parse a tech-guide response. Returns null when no JSON object is present. */
export function parseTechGuide(text: string): LdTechGuide | null {
  const extracted = extractOutermostJson(stripFences(text))
  if (!extracted) return null
  try {
    return normalizeTechGuide(JSON.parse(extracted))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Cache key. Vehicle-specific, so P0420 on a Yukon XL is not P0420 on a Neon.
// Kept identical to NWI Suite's scheme so an entry written there is found here.
// We only ever READ that table — see ./ld-cache.
// ---------------------------------------------------------------------------

export function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function ldCodeCacheKey(code: string, year: string, make: string, model: string): string {
  return `ld-${slug(code)}-${slug(year)}-${slug(make)}-${slug(model)}`
}

export function ldSymptomCacheKey(
  symptom: string,
  year: string,
  make: string,
  model: string,
): string {
  return `ld-symptom-${slug(symptom).slice(0, 40)}-${slug(year)}-${slug(make)}-${slug(model)}`
}

// ---------------------------------------------------------------------------
// Plain-text render. Used to append a diagnostic to a job's notes, so what the
// tech saw on screen is what lands on the job — disclaimer and citations
// included, never stripped.
// ---------------------------------------------------------------------------

function bulleted(title: string, lines: string[]): string[] {
  if (lines.length === 0) return []
  return ['', `${title}:`, ...lines.map((l) => `  - ${l}`)]
}

function ordered(title: string, lines: string[]): string[] {
  if (lines.length === 0) return []
  return ['', `${title}:`, ...lines.map((l, i) => `  ${i + 1}. ${l}`)]
}

export function formatDiagnosticForNotes(
  d: LdDiagnostic,
  vehicle: Partial<LdVehicleInput>,
  when: Date = new Date(),
): string {
  const head = d.code && d.code !== 'NO-CODE' ? `${d.code} — ${d.name}` : d.name || 'Diagnostic'

  const out: string[] = [
    `QuickWrench LD — ${head}`,
    `Vehicle: ${vehicleLabel(vehicle)}${vehicle.engine ? ` (${vehicle.engine})` : ''}`,
    `Run: ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  ]

  if (d.category) out.push(`Category: ${d.category}`)
  if (d.severity) {
    out.push(
      `Severity: ${d.severity.toUpperCase()}${
        d.severity_description ? ` — ${d.severity_description}` : ''
      }`,
    )
  }

  out.push(...bulleted('Symptoms', d.symptoms))
  out.push(...bulleted('Common causes', d.common_causes))
  out.push(...ordered('Diagnostic order', d.diagnostic_order))
  out.push(...ordered('Repair steps', d.repair_steps))
  out.push(...bulleted('Parts needed', d.parts_needed))
  out.push(...bulleted('Related codes', d.related_codes))

  if (d.suggested_repair) out.push('', `Suggested repair: ${d.suggested_repair}`)
  if (d.special_tools)    out.push('', `Special tools: ${d.special_tools}`)
  if (d.labor_estimate)   out.push('', `Labor estimate: ${d.labor_estimate}`)
  if (d.safety_warnings)  out.push('', `Safety: ${d.safety_warnings}`)

  out.push(...bulleted('Sources', d.citations))
  out.push('', AI_DISCLAIMER)

  return out.join('\n')
}

// SERVER-ONLY diagnostic engine for QuickWrench HD.
//
// Ported from national_wrench_index/src/app/api/hd/quickwrench/route.ts (1,513
// lines) and .../api/hd/truck-diagnostic/route.ts. The prompt corpus lives in
// hd-prompts.ts, the reference reads in hd-reference.ts, the pure gauge engine
// in hd-gauge.ts, and the offline J1939 tables in hd-j1939.ts. This file is the
// orchestration: build the prompt, try the cache, call a model, shape the result.
//
// ── MODEL PATH — READ THIS BEFORE CHANGING IT ───────────────────────────────
// NWI Suite runs Gemini (grounded, with Google Search) as the primary engine and
// falls back to Anthropic only when Gemini errors. In THIS deployment that
// priority is effectively inverted, on purpose:
//
//   GEMINI_API_KEY is NOT set.  ANTHROPIC_API_KEY IS set.
//
// So the Anthropic path is not a reliability afterthought here — it is the path
// that actually answers a tech's question today. It is wired as a first-class
// engine: same system prompts, same section contract, same disclaimers, and it
// is selected without an error having to happen first. If a Gemini key is added
// later, Gemini takes the lead automatically and brings grounding citations with
// it; nothing else has to change.
//
// The trade-off is stated to the tech rather than hidden: the Anthropic path has
// no web grounding, so it returns no citations, and the UI labels it as such.
//
// ── SAFETY ──────────────────────────────────────────────────────────────────
// A wrong torque spec or refrigerant charge on a Class 8 truck hurts someone.
// Every answer this engine returns is labelled as AI-generated and requiring
// verification against the service manual, carries the manufacturer disclaimer
// verbatim, and surfaces its grounding citations when it has any. We never
// fabricate a spec, and when no engine is available we say exactly that instead
// of guessing.

import { getAnthropic, anthropicConfigured } from '@/lib/anthropic'
import {
  generateDiagnostic,
  isGeminiConfigured,
  GEMINI_MODEL_ID,
} from '@/lib/gemini'
import { detectsHazard, formatDiagnostic, splitSections, type DiagnosticSection } from './hd-format'
import {
  CARRIER_DISCLAIMER,
  ELECTRICAL_SYSTEM_PROMPT,
  REEFER_FALLBACK_ANALYSIS,
  REEFER_SYSTEM_PROMPT,
  REEFER_WEB_SEARCH_DIRECTIVE,
  TK_DISCLAIMER,
  TRUCK_DISCLAIMER,
  TRUCK_FALLBACK_ANALYSIS,
  TRUCK_SYSTEM_PROMPT,
  TRUCK_WEB_SEARCH_DIRECTIVE,
} from './hd-prompts'
import type { HdPart } from './hd-reference'

/**
 * Fallback model. NWI Suite pins `claude-haiku-4-5-20251001`; the undated id is
 * the current form of the same model and is what the SDK expects.
 */
export const HD_FALLBACK_MODEL = 'claude-haiku-4-5'

/**
 * Suite caps the fallback at 1,500 tokens. That truncates the seven-section
 * format mid-answer often enough to matter — a diagnostic that stops before
 * SAFETY WARNINGS is worse than no diagnostic — so the cap is raised here. It is
 * still small enough to keep a shop-floor lookup cheap.
 */
export const HD_FALLBACK_MAX_TOKENS = 4000

/** Shown above every AI-generated answer. Never suppress this. */
export const AI_VERIFY_NOTICE =
  'AI-generated diagnostic. Verify every specification, torque value, part number and refrigerant charge against the OEM service manual before you turn a wrench. Do not act on a number from this screen alone.'

export type HdDomain = 'truck' | 'reefer' | 'electrical'

/** Which engine produced the text the tech is looking at. */
export type HdEngineSource = 'cache' | 'gemini' | 'anthropic' | 'unavailable'

export interface HdDiagnosticResult {
  analysis:   string
  sections:   DiagnosticSection[]
  citations:  string[]
  source:     HdEngineSource
  /** Model id, or null on the cache / unavailable paths. */
  model:      string | null
  /** True when the answer mentions a hazard the UI must banner. */
  hazard:     boolean
  /** Manufacturer / standards disclaimer, verbatim from NWI Suite. */
  disclaimer: string
  /** False when no engine was reachable — the UI must not present this as advice. */
  usable:     boolean
}

// ---------------------------------------------------------------------------
// Prompt inputs
// ---------------------------------------------------------------------------

export interface TruckDiagnosticInput {
  domain:        'truck'
  truckBrand:    string
  engineModel:   string
  spn?:          string
  fmi?:          string
  symptom?:      string
  vehicleYear?:  string
  vehicleMake?:  string
  vehicleModel?: string
  vehicleEngine?: string
}

export interface ReeferDiagnosticInput {
  domain:        'reefer'
  manufacturer:  string
  model:         string
  unitType?:     string
  alarmCode?:    string
  symptom?:      string
  serialNumber?: string
  displayMessage?: string
  /** Definition text from the reefer alarm-codes tool, when it could supply one. */
  alarmDefinition?: string
}

export interface ElectricalDiagnosticInput {
  domain:   'electrical'
  topic?:   string
  question: string
}

export type HdDiagnosticInput =
  | TruckDiagnosticInput
  | ReeferDiagnosticInput
  | ElectricalDiagnosticInput

export function disclaimerFor(input: HdDiagnosticInput): string {
  if (input.domain === 'truck' || input.domain === 'electrical') return TRUCK_DISCLAIMER
  return input.manufacturer === 'Carrier Transicold' ? CARRIER_DISCLAIMER : TK_DISCLAIMER
}

function fallbackTextFor(domain: HdDomain): string {
  return domain === 'reefer' ? REEFER_FALLBACK_ANALYSIS : TRUCK_FALLBACK_ANALYSIS
}

/**
 * System prompt per domain. The grounded preamble is only prepended on the
 * Gemini path — it instructs the model to search first, which an ungrounded
 * Anthropic call cannot do and must not be told to pretend it did.
 */
function promptsFor(domain: HdDomain): { system: string; searchDirective: string } {
  switch (domain) {
    case 'reefer':
      return { system: REEFER_SYSTEM_PROMPT, searchDirective: REEFER_WEB_SEARCH_DIRECTIVE }
    case 'electrical':
      // The electrical corpus is self-contained field knowledge; Suite calls it
      // ungrounded on both paths, so there is no search directive.
      return { system: ELECTRICAL_SYSTEM_PROMPT, searchDirective: '' }
    case 'truck':
    default:
      return { system: TRUCK_SYSTEM_PROMPT, searchDirective: TRUCK_WEB_SEARCH_DIRECTIVE }
  }
}

// ---------------------------------------------------------------------------
// User prompt builders — ported from Suite, one per domain.
// ---------------------------------------------------------------------------

export function buildTruckPrompt(input: TruckDiagnosticInput): string {
  const vehicleBits = [
    input.vehicleYear?.trim()   ? `Year: ${input.vehicleYear.trim()}`     : null,
    input.vehicleMake?.trim()   ? `Make: ${input.vehicleMake.trim()}`     : null,
    input.vehicleModel?.trim()  ? `Model: ${input.vehicleModel.trim()}`   : null,
    input.vehicleEngine?.trim() ? `Engine: ${input.vehicleEngine.trim()}` : null,
  ].filter(Boolean)

  // Explicit search query: always year + make + model + engine brand + engine
  // model + SPN + FMI — never the SPN on its own.
  const searchQuery = [
    input.vehicleYear?.trim(),
    input.vehicleMake?.trim(),
    input.vehicleModel?.trim(),
    input.truckBrand,
    input.engineModel,
    input.spn ? `SPN ${input.spn}` : null,
    input.fmi ? `FMI ${input.fmi}` : null,
  ].filter(Boolean).join(' ').trim()

  const parts: string[] = []
  if (vehicleBits.length > 0) parts.push(`Vehicle — ${vehicleBits.join(', ')}`)
  else parts.push('Vehicle: not specified — ask the tech for year, make, and model before giving a vehicle-specific answer.')
  parts.push(`Engine: ${input.truckBrand} ${input.engineModel}`)
  if (input.spn)     parts.push(`SPN (Suspect Parameter Number): ${input.spn}`)
  if (input.fmi)     parts.push(`FMI (Failure Mode Identifier): ${input.fmi}`)
  if (input.symptom) parts.push(`Symptom/Question: ${input.symptom}`)
  if (searchQuery)   parts.push(`Run this web search first: "${searchQuery} diagnostic repair procedure"`)
  return parts.join('\n')
}

export function buildReeferPrompt(input: ReeferDiagnosticInput): string {
  const parts: (string | null)[] = [
    `Unit: ${input.manufacturer} ${input.model} (${input.unitType ?? 'unknown type'})`,
    input.alarmCode      ? `Alarm Code(s): ${input.alarmCode}` : null,
    input.displayMessage ? `The unit display shows: '${input.displayMessage}'` : null,
    input.symptom        ? `Symptom/Question: ${input.symptom}` : null,
    input.serialNumber   ? `Serial Number: ${input.serialNumber}` : null,
  ]

  if (input.alarmDefinition) {
    const header = input.manufacturer === 'Carrier Transicold'
      ? '\nOFFICIAL CARRIER DEFINITIONS (Carrier Transicold Operator Reference):'
      : '\nOFFICIAL TK DEFINITIONS (TK 40933-8-CH Rev 15):'
    parts.push(header, input.alarmDefinition, 'Use these as the authoritative basis — do not contradict them.')
  }

  return parts.filter(Boolean).join('\n')
}

export function buildElectricalPrompt(input: ElectricalDiagnosticInput): string {
  return [
    input.topic ? `Topic: ${input.topic}` : null,
    `Question: ${input.question.trim()}`,
  ].filter(Boolean).join('\n')
}

export function buildUserPrompt(input: HdDiagnosticInput): string {
  switch (input.domain) {
    case 'truck':      return buildTruckPrompt(input)
    case 'reefer':     return buildReeferPrompt(input)
    case 'electrical': return buildElectricalPrompt(input)
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/** True when at least one model engine can be reached. */
export function hdEngineAvailable(): boolean {
  return isGeminiConfigured() || anthropicConfigured()
}

export interface EngineStatus {
  gemini:    boolean
  anthropic: boolean
  /** The engine a diagnostic would use right now. */
  primary:   'gemini' | 'anthropic' | null
  model:     string | null
  /** Only the grounded path returns source citations. */
  grounded:  boolean
}

export function hdEngineStatus(): EngineStatus {
  const gemini = isGeminiConfigured()
  const anthropic = anthropicConfigured()
  if (gemini) {
    return { gemini, anthropic, primary: 'gemini', model: GEMINI_MODEL_ID, grounded: true }
  }
  if (anthropic) {
    return { gemini, anthropic, primary: 'anthropic', model: HD_FALLBACK_MODEL, grounded: false }
  }
  return { gemini, anthropic, primary: null, model: null, grounded: false }
}

/** Ungrounded Anthropic call. Returns '' rather than throwing. */
async function runAnthropic(systemPrompt: string, userPrompt: string): Promise<string> {
  const client = getAnthropic()
  if (!client) return ''

  try {
    const message = await client.messages.create(
      {
        model:      HD_FALLBACK_MODEL,
        max_tokens: HD_FALLBACK_MAX_TOKENS,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      },
      { timeout: 45_000, maxRetries: 1 },
    )
    return message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim()
  } catch (err) {
    console.error('[quickwrench-hd] Anthropic call failed', err)
    return ''
  }
}

/** Grounded Gemini call plus the reshaping pass. Returns null rather than throwing. */
async function runGemini(
  systemPrompt: string,
  searchDirective: string,
  userPrompt: string,
  formatContext: Parameters<typeof formatDiagnostic>[1],
): Promise<{ text: string; citations: string[] } | null> {
  try {
    const system = searchDirective ? `${searchDirective}\n\n${systemPrompt}` : systemPrompt
    const { text, citations } = await generateDiagnostic(userPrompt, system)
    if (!text.trim()) return null
    const formatted = (await formatDiagnostic(text, formatContext)).trim()
    return formatted ? { text: formatted, citations } : null
  } catch (err) {
    console.error('[quickwrench-hd] Gemini grounded generation failed', err)
    return null
  }
}

function formatContextFor(input: HdDiagnosticInput): Parameters<typeof formatDiagnostic>[1] {
  if (input.domain === 'truck') {
    return {
      engineBrand: input.truckBrand,
      engineModel: input.engineModel,
      spn:         input.spn,
      fmi:         input.fmi,
    }
  }
  if (input.domain === 'reefer') {
    return {
      manufacturer: input.manufacturer,
      model:        input.model,
      alarmCode:    input.alarmCode,
    }
  }
  return {}
}

export interface RunOptions {
  /** Text pulled from NWI Suite's read-only cache. Skips the model call. */
  cached?: { text: string; citations: string[] } | null
  /** Model-scoped parts to append as a PARTS REFERENCE section. */
  parts?:  HdPart[]
}

/**
 * The whole diagnostic path in one call: cache → Gemini (grounded) → Anthropic
 * (ungrounded) → an honest "no engine available" answer. Never throws; the
 * caller always gets a renderable result.
 */
export async function runHdDiagnostic(
  input: HdDiagnosticInput,
  options: RunOptions = {},
): Promise<HdDiagnosticResult> {
  const disclaimer = disclaimerFor(input)
  const userPrompt = buildUserPrompt(input)
  const { system, searchDirective } = promptsFor(input.domain)

  let analysis = ''
  let citations: string[] = []
  let source: HdEngineSource = 'unavailable'
  let model: string | null = null

  if (options.cached?.text) {
    analysis  = options.cached.text
    citations = options.cached.citations
    source    = 'cache'
  }

  if (!analysis && isGeminiConfigured()) {
    const result = await runGemini(system, searchDirective, userPrompt, formatContextFor(input))
    if (result) {
      analysis  = result.text
      citations = result.citations
      source    = 'gemini'
      model     = GEMINI_MODEL_ID
    }
  }

  if (!analysis && anthropicConfigured()) {
    const text = await runAnthropic(system, userPrompt)
    if (text) {
      analysis = text
      source   = 'anthropic'
      model    = HD_FALLBACK_MODEL
    }
  }

  const usable = analysis.length > 0
  if (!usable) analysis = fallbackTextFor(input.domain)

  // Parts are a database read, not model output, so they are appended after the
  // answer and labelled as reference only — never presented as a spec.
  if (options.parts && options.parts.length > 0) {
    analysis += `\n\nPARTS REFERENCE:\n${options.parts
      .map((p) =>
        `${p.part_number} — ${p.description}` +
        (p.field_critical ? ' [FIELD CRITICAL]' : '') +
        (p.superseded_by ? ` — superseded by ${p.superseded_by}` : '') +
        (p.notes ? ` — ${p.notes}` : ''),
      )
      .join('\n')}\nPart numbers are reference only. Verify fitment before ordering, and always order the current replacement for a superseded number.`
  }

  return {
    analysis,
    sections: splitSections(analysis),
    citations,
    source,
    model,
    hazard: usable && detectsHazard(analysis),
    disclaimer,
    usable,
  }
}

/**
 * A plain-text block a tech can paste into a job's notes. Carries the engine
 * that produced it, the verification notice and the disclaimer, so a diagnostic
 * that ends up on an invoice still says where it came from.
 */
export function toJobNote(
  result: HdDiagnosticResult,
  heading: string,
): string {
  const engineLabel =
    result.source === 'cache'     ? 'AI diagnostic (cached)' :
    result.source === 'gemini'    ? `AI diagnostic (${result.model}, web-grounded)` :
    result.source === 'anthropic' ? `AI diagnostic (${result.model})` :
    'Diagnostic engine unavailable'

  const lines = [
    `QuickWrench HD — ${heading}`,
    engineLabel,
    '',
    result.analysis.trim(),
    '',
    AI_VERIFY_NOTICE,
    result.disclaimer,
  ]
  if (result.citations.length > 0) {
    lines.push('', 'Sources:', ...result.citations.map((c) => `- ${c}`))
  }
  return lines.join('\n')
}

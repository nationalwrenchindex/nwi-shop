// POST /api/shop/tools/trailer-abs/diagnostic
//
// Trailer ABS diagnostic. Ported from national_wrench_index
// src/app/api/hd/trailer-abs-diagnostic/route.ts — same prompt, same parser, same
// confidence ladder, same hand-owned labor table. Swapped for NWI Shop: the HD
// subscription check becomes apiFeature('trailer_abs'), the rate limit is keyed on the
// shop rather than the user, and two pieces of Suite plumbing are dropped (see below).
//
// This route is different in kind from the other diagnostics beside it. A wrong answer
// about a reefer alarm wastes a tech's afternoon. A wrong answer about trailer ABS puts
// a brake system that FMVSS 121 mandates back on the road in a state the tech believes
// is fixed. Every decision below follows from that:
//
//   - It never guesses. Low model confidence, an unknown ECU generation, or a response
//     it cannot parse all produce a clarification question, not a diagnosis.
//   - It never fabricates to fill a gap. A model outage returns a documented fallback
//     pointing at the manufacturer literature and the ECU decal — not a plausible
//     sounding fault description generated from nothing.
//   - It never invents money. Labor comes from the hand-owned table in
//     @/lib/shop/trailer/abs-labor. No number the model wrote reaches a labor line.
//
// DROPPED FROM THE PORT, both deliberately:
//   1. The hd_parts_reference lookup. Suite's own comment records that the table holds
//      only reefer parts and zero trailer parts, so its double gate returns [] on every
//      request. See the note at the top of @/lib/shop/trailer/reference for the full
//      reasoning.
//   2. The hd_quickwrench_usage logging. That table belongs to the Suite project and
//      keys on a Suite user; NWI Shop has no such table and must not write Suite's.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { generateText, isGeminiConfigured, geminiNotConfigured } from '@/lib/gemini'
import { ABS_GEMINI_SYSTEM_PROMPT } from '@/lib/shop/trailer/abs-gemini-prompt'
import {
  ABS_FAULT_CATEGORIES,
  classifyABSFault,
  resolveABSLabor,
  type ABSLaborEntry,
} from '@/lib/shop/trailer/abs-labor'
import {
  ABS_MANUFACTURERS,
  ECU_HOUSING_HINT,
  absFallbackResponse,
  absSafeSteps,
  isABSManufacturer,
  type ABSDiagnosticResponse,
  type ABSManufacturer,
} from '@/lib/shop/trailer/abs-diagnostic-contract'
import { checkTrailerAbsRateLimit } from '@/lib/shop/trailer/rate-limit'

// Same 60s ceiling as the other AI routes: the shared Gemini client gives up at 55s,
// which has to fit inside the platform's function limit.
export const maxDuration = 60

// ─── Model output parsing ─────────────────────────────────────────────────────

interface ParsedModelOutput {
  fault_description:      string
  fault_category:         string | null
  confidence:             'high' | 'medium' | 'low'
  diagnostic_steps:       string[]
  specs_to_check:         string[]
  tools_needed:           string[]
  clarification_needed:   boolean
  clarification_question: string | null
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

// Pulls the JSON object out of whatever the model returned. Handles a fenced code block
// and leading commentary, because a thinking model sometimes prefixes prose.
//
// Everything here fails CLOSED. If the object cannot be found, cannot be parsed, or does
// not carry the fields required to be a real diagnosis, this returns null and the caller
// falls back to a clarification — it never salvages half an object into a diagnosis.
function parseModelOutput(raw: string): ParsedModelOutput | null {
  if (!raw || !raw.trim()) return null

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body   = (fenced?.[1] ?? raw).trim()

  const start = body.indexOf('{')
  const end   = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  let obj: unknown
  try {
    obj = JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null

  const o = obj as Record<string, unknown>

  const faultDescription = typeof o.fault_description === 'string' ? o.fault_description.trim() : ''
  const steps            = toStringArray(o.diagnostic_steps)

  const rawConfidence = typeof o.confidence === 'string' ? o.confidence.trim().toLowerCase() : ''
  // An unrecognised or missing confidence value is treated as 'low', never as 'high'.
  // The safe default on a brake system is to assume the model is unsure.
  const confidence: ParsedModelOutput['confidence'] =
    rawConfidence === 'high' ? 'high' : rawConfidence === 'medium' ? 'medium' : 'low'

  const clarificationQuestion =
    typeof o.clarification_question === 'string' && o.clarification_question.trim().length > 0
      ? o.clarification_question.trim()
      : null

  // A response with no fault description AND no steps is prose or an empty shell, not a
  // structured answer — unless the model is explicitly asking a question, which is a
  // legitimate and welcome outcome.
  const isAskingQuestion = o.clarification_needed === true && clarificationQuestion !== null
  if (!faultDescription && steps.length === 0 && !isAskingQuestion) return null

  return {
    fault_description:      faultDescription,
    fault_category:         typeof o.fault_category === 'string' ? o.fault_category.trim() : null,
    confidence,
    diagnostic_steps:       steps,
    specs_to_check:         toStringArray(o.specs_to_check),
    tools_needed:           toStringArray(o.tools_needed),
    clarification_needed:   o.clarification_needed === true,
    clarification_question: clarificationQuestion,
  }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────
//
// The system prompt (the ABS knowledge base) lives in
// @/lib/shop/trailer/abs-gemini-prompt. The RESPONSE FORMAT block below is owned by this
// route instead, because the JSON shape is this route's contract with its caller: the
// parser above and this block have to change together, and they should not be able to
// drift apart across two files.

function buildUserPrompt(input: {
  manufacturer:        ABSManufacturer
  ecuGeneration:       string
  blinkCode:           string
  symptoms:            string
  clarificationAnswer: string
}): string {
  const lines = [
    `ABS manufacturer: ${input.manufacturer.toUpperCase()}`,
    `ECU generation (as reported by the technician): ${input.ecuGeneration || 'NOT PROVIDED'}`,
    `Blink code / fault code as flashed: ${input.blinkCode || 'NOT PROVIDED'}`,
    input.symptoms            ? `Symptoms reported: ${input.symptoms}` : null,
    input.clarificationAnswer ? `Technician's answer to your previous clarification question: ${input.clarificationAnswer}` : null,
  ].filter(Boolean).join('\n')

  return `${lines}

RESPONSE FORMAT — RETURN ONE JSON OBJECT AND NOTHING ELSE. No prose before or after it, no markdown fence.

{
  "fault_description": "One paragraph naming the fault. Leave this an empty string if you are asking for clarification instead of diagnosing.",
  "fault_category": "exactly one of ${ABS_FAULT_CATEGORIES.join(' | ')} — or null if the repair is not one of these",
  "confidence": "high | medium | low",
  "diagnostic_steps": ["ordered steps, one per array entry"],
  "specs_to_check": ["each measurable spec with its expected value and units"],
  "tools_needed": ["each tool"],
  "clarification_needed": true or false,
  "clarification_question": "a specific question naming exactly what to read off the ECU housing, or null"
}

RULES THAT OVERRIDE ANY URGE TO BE HELPFUL:
- This is a federally mandated brake system. Answer "I need to know X" rather than producing a likely-sounding diagnosis.
- Blink code tables differ between ECU generations. If the ECU generation is missing, vague, or does not match the code given, set confidence to "low", set clarification_needed to true, and ask a clarification_question that names exactly what is printed on the ECU housing to look for.
- Never state a code meaning you are not certain applies to THIS ECU generation.
- Do not estimate labor hours or name part numbers to buy. Those are handled outside your response.
- "confidence": "high" means you would stake a brake job on it. Use "low" freely.`
}

// Keyword fallback for the labor lookup, run over the model's own words when it did not
// return a usable fault_category. Still deterministic — the table owns the hours.
function classifyABSFaultToLabor(faultDescription: string, steps: string[]): ABSLaborEntry | null {
  return resolveABSLabor(classifyABSFault([faultDescription, ...steps].join(' ')))
}

function json(body: ABSDiagnosticResponse | { error: string }, init?: ResponseInit): Response {
  return Response.json(body, init)
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { ctx, error } = await apiFeature('trailer_abs')
  if (error) return error

  // Cost guardrail, NOT a security control — see @/lib/shop/trailer/rate-limit for the
  // honest limitation. It exists to stop a stuck retry loop or an impatient double-tap
  // from firing a dozen 55-second model calls, and nothing more.
  const limit = checkTrailerAbsRateLimit(ctx.shop.id)
  if (!limit.allowed) {
    return json(
      { error: 'Too many diagnostic requests from this shop. Wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    )
  }

  let body: Record<string, unknown>
  try {
    const parsedBody: unknown = await req.json()
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return json({ error: 'Expected a JSON object body.' }, { status: 400 })
    }
    body = parsedBody as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid body' }, { status: 400 })
  }

  // Manufacturer is a hard 400 rather than a clarification. WABCO, Bendix, and Haldex are
  // genuinely different systems with different blink code tables, and this route has no
  // safe behaviour for a fourth value — answering about "trailer ABS in general" would be
  // exactly the generic guess the whole design exists to prevent.
  if (!isABSManufacturer(body.manufacturer)) {
    return json(
      { error: `manufacturer must be one of: ${ABS_MANUFACTURERS.join(', ')}` },
      { status: 400 },
    )
  }
  const manufacturer = String(body.manufacturer).trim().toLowerCase() as ABSManufacturer

  const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const ecuGeneration       = asText(body.ecu_generation)
  const blinkCode           = asText(body.blink_code)
  const symptoms            = asText(body.symptoms)
  const clarificationAnswer = asText(body.clarification_answer)

  if (!blinkCode && !symptoms) {
    return json({ error: 'blink_code or symptoms required' }, { status: 400 })
  }

  // Unknown ECU generation is answered here, without spending a model call. It is the
  // single most common way a trailer ABS diagnosis goes wrong: the same flash pattern
  // means different things on Haldex Gen 4 and Gen 5, and on Bendix TABS-6 versus the
  // trailer EC series. There is no confident answer to be had, so we ask instead of
  // paying for a model round trip that could only produce a hedge.
  //
  // A clarification_answer bypasses this: it means the tech has already been asked once
  // and has come back with what they read off the housing.
  const ECU_UNKNOWN = /^(unknown|unsure|not sure|n\/?a|none|\?+|idk)$/i
  if (!clarificationAnswer && (!ecuGeneration || ECU_UNKNOWN.test(ecuGeneration))) {
    return json({
      fault_description:      '',
      diagnostic_steps:       absSafeSteps(manufacturer),
      specs_to_check:         [],
      tools_needed:           [],
      clarification_needed:   true,
      clarification_question: `Which ECU generation is on this trailer? Read ${ECU_HOUSING_HINT[manufacturer]} and enter it — the same blink code means different things on different generations, so no diagnosis is safe without it.`,
      labor_estimate:         null,
    })
  }

  // No key: the documented 503 every AI route in NWI Shop returns, so the page shows one
  // consistent "not configured" banner. The reference browser beside this form does not
  // go through here and keeps working — including the full ABS blink-code rows, which are
  // the thing a tech actually needs when the AI is unavailable.
  if (!isGeminiConfigured()) return geminiNotConfigured()

  // generateText, not generateDiagnostic — i.e. NO Google Search grounding, on purpose.
  // Two reasons. First, grounding is wrong when the output must be a strict JSON object,
  // because the model starts narrating sources instead. Second and more important,
  // grounding on a trailer ABS blink code would pull in whichever ABS code chart a search
  // engine surfaces, and the documented failure mode of this whole subject is a chart for
  // the WRONG ECU generation being applied confidently to the ECU in front of the tech.
  //
  // No maxOutputTokens cap: gemini-3.6-flash is a thinking model and a small cap gets
  // consumed by reasoning tokens, returning empty visible output.
  let rawOutput = ''
  try {
    rawOutput = await generateText(
      buildUserPrompt({ manufacturer, ecuGeneration, blinkCode, symptoms, clarificationAnswer }),
      ABS_GEMINI_SYSTEM_PROMPT,
    )
  } catch (err) {
    console.error('[shop/trailer-abs] Gemini call failed', err)
    return json(absFallbackResponse(manufacturer, 'the AI service did not respond'))
  }

  const parsed = parseModelOutput(rawOutput)

  // Prose, malformed JSON, or a shell with no content. We do NOT try to read a diagnosis
  // out of unstructured text — a half-understood sentence about a brake fault is the
  // exact thing this route must not emit.
  if (!parsed) {
    console.error('[shop/trailer-abs] unparseable model output', rawOutput.slice(0, 400))
    return json(absFallbackResponse(manufacturer, 'the AI response could not be read'))
  }

  // CONFIDENCE LADDER — the route decides what gets committed to, not the model.
  //   low     → no fault description at all. Clarification only, plus the safe steps.
  //   medium  → verification steps are shown (checking a wheel end hurts nobody) but the
  //             answer is still flagged as needing confirmation and carries no estimate.
  //   high    → committed diagnosis, and only here does a labor estimate appear.
  // The model's own clarification_needed flag can raise the bar but never lower it.
  const committed = parsed.confidence === 'high' && !parsed.clarification_needed
  const clarificationNeeded = !committed

  const defaultQuestion = `To confirm this before you touch the brakes, read ${ECU_HOUSING_HINT[manufacturer]} and tell me what it says.`

  // Labor is looked up from the deterministic table keyed on the model's category, with a
  // keyword classification of its own text as the fallback. The model never supplies
  // hours. And no estimate is attached to an uncommitted diagnosis — an hours figure on
  // an unconfirmed fault is a number that ends up quoted to a customer.
  const labor: ABSLaborEntry | null = committed
    ? (resolveABSLabor(parsed.fault_category)
      ?? classifyABSFaultToLabor(parsed.fault_description, parsed.diagnostic_steps))
    : null

  return json({
    fault_description: parsed.confidence === 'low' ? '' : parsed.fault_description,
    diagnostic_steps: parsed.confidence === 'low'
      ? (parsed.diagnostic_steps.length > 0 ? parsed.diagnostic_steps : absSafeSteps(manufacturer))
      : parsed.diagnostic_steps,
    specs_to_check:         parsed.specs_to_check,
    tools_needed:           parsed.tools_needed,
    clarification_needed:   clarificationNeeded,
    clarification_question: clarificationNeeded
      ? (parsed.clarification_question ?? defaultQuestion)
      : null,
    labor_estimate:         labor,
  })
}

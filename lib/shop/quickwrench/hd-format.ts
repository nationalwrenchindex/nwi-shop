// SERVER-ONLY. Two small support modules ported from NWI Suite:
//   - src/lib/gemini/formatter.ts  → formatDiagnostic()
//   - src/lib/gemini/hazard.ts     → detectsHazard()
//
// formatDiagnostic() is the SECOND, ungrounded pass of the Gemini two-pass
// shape: the grounded pass does the thinking and the searching, this pass only
// reshapes that text into our fixed section headers. It must not add or remove
// content — especially safety warnings, voltage specs, part numbers and torque
// specs — and on any failure it returns the raw text unchanged. Raw text beats
// no text, and we never fail silently.
//
// When GEMINI_API_KEY is unset (the case in this deployment) formatDiagnostic
// is a no-op passthrough. That is fine: the Anthropic fallback in hd.ts is given
// the same section-header instruction inside its system prompt, so it emits the
// structure directly and needs no reshaping pass.

import { generateText, isGeminiConfigured } from '@/lib/gemini'

const FORMAT_INSTRUCTION = `You are a technical formatting assistant for a field service diagnostic platform used by mobile mechanics and transport refrigeration technicians.

Your job is to take raw AI diagnostic content and reformat it into clean, structured sections. You are ONLY reformatting — do not add information, do not remove information, do not change any voltage specs, part numbers, resistance values, or technical details. Preserve everything exactly.

FORMAT THE CONTENT INTO THESE EXACT SECTIONS IN THIS EXACT ORDER. Each section must start on a new line with the header in ALL CAPS followed by a colon:

ALARM MEANING:
[2-3 sentences maximum explaining what this code means]

MOST LIKELY CAUSES:
1. [First cause]
2. [Second cause]
3. [Third cause]
(numbered list, one cause per line, maximum 8 causes)

DIAGNOSTIC STEPS:
1. [First step — include exact voltage/ohm specs and test mode]
2. [Second step]
3. [Third step]
(numbered list, one step per line, include all technical specs)

COMMON FIX:
[2-3 sentences on the most common resolution in the field]

PARTS NEEDED:
[List each part on its own line with OEM part number if available]

SPECIAL TOOLS REQUIRED:
[List any special tools, or state: Standard hand tools and digital multimeter only]

SAFETY WARNINGS:
[Safety warnings — include specific voltages and whether unit must be running or off for each phase of diagnosis and repair]

PM NOTE:
[Preventive maintenance notes relevant to this code]

CRITICAL FORMATTING RULES:
- Never write a paragraph when a list will do
- Every diagnostic step must be on its own numbered line
- Every cause must be on its own numbered line
- Never combine two steps into one line
- Use plain language a field tech can read at a glance
- Short sentences. No run-ons.
- If the source content does not have information for a section, write: Not specified — never leave a section blank
- Preserve ALL numbers exactly: voltages, resistances, part numbers, torque specs, temperatures

Preserve ALL voltage specifications exactly as provided — do not simplify, round, or generalize voltage values. If the source states 400-480VAC 3-phase, format it exactly as 400-480VAC 3-phase. Never substitute a different voltage value during formatting.`

export interface FormatContext {
  manufacturer?: string
  model?:        string
  alarmCode?:    string
  engineBrand?:  string
  engineModel?:  string
  spn?:          string
  fmi?:          string
}

export async function formatDiagnostic(
  rawText: string,
  context: FormatContext,
): Promise<string> {
  if (!isGeminiConfigured() || !rawText.trim()) return rawText

  const ctxLine = [
    context.manufacturer && `Manufacturer: ${context.manufacturer}`,
    context.model        && `Unit model: ${context.model}`,
    context.alarmCode    && `Alarm code: ${context.alarmCode}`,
    context.engineBrand  && `Engine brand: ${context.engineBrand}`,
    context.engineModel  && `Engine model: ${context.engineModel}`,
    context.spn          && `SPN: ${context.spn}`,
    context.fmi          && `FMI: ${context.fmi}`,
  ].filter(Boolean).join('\n')

  try {
    // No maxOutputTokens cap: the Gemini model is a thinking model and a small
    // cap is consumed by reasoning tokens, leaving the visible output empty —
    // which would drop the whole formatted diagnostic.
    const formatted = (await generateText(
      `${ctxLine ? ctxLine + '\n\n' : ''}Diagnostic content to format:\n\n${rawText}`,
      FORMAT_INSTRUCTION,
    )).trim()
    return formatted || rawText
  } catch (err) {
    console.error('[quickwrench-hd] formatting pass failed — returning raw text', err)
    return rawText
  }
}

// ---------------------------------------------------------------------------
// Hazard detection. In NWI Suite this gates a founder review queue on the cache
// table. Here it drives the UI: when a diagnostic mentions high voltage,
// refrigerant work, high pressure or a running engine, the result panel renders
// a hard safety banner above the text instead of leaving it to the tech to spot
// the warning halfway down.
// ---------------------------------------------------------------------------

const HAZARD_PATTERNS: RegExp[] = [
  // High voltage AC
  /\bVAC\b/i,
  /\b3[\s-]?phase\b|three[\s-]?phase/i,
  /\b230\s?V\b|\b460\s?V\b/i,
  /high voltage(?:\s+AC)?/i,
  // Energized / live circuits, motor terminals
  /energized circuit|live circuit|motor terminal/i,
  // Refrigerant handling
  /refrigerant recovery|EPA\s?608|system opening|open(?:ing)?\s+the\s+system/i,
  // High pressure
  /high pressure line|discharge pressure|pressurized/i,
  // Running engine / rotating components
  /engine running|running engine|rotating component/i,
]

export function detectsHazard(text: string): boolean {
  if (!text) return false
  if (HAZARD_PATTERNS.some((re) => re.test(text))) return true

  // Discharge / refrigerant pressure above 200 PSI.
  const psiMatches = text.match(/(\d{2,4})\s?psi/gi)
  if (psiMatches) {
    for (const m of psiMatches) {
      const n = parseInt(m, 10)
      if (Number.isFinite(n) && n > 200) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Section splitting. The prompts pin a fixed set of ALL-CAPS headers, so the UI
// can render the answer as labelled blocks instead of a wall of text. Anything
// the model emits before the first header is kept as a preamble so nothing is
// ever silently dropped.
// ---------------------------------------------------------------------------

// Singular 'SAFETY WARNING' is deliberate: the prompts tell the model to lead
// with a safety block and it writes that header both ways, sometimes prefixed
// with a warning glyph. Matching on the shorter form catches every variant.
export const HD_SECTION_HEADERS = [
  'ALARM MEANING',
  'MOST LIKELY CAUSES',
  'DIAGNOSTIC STEPS',
  'COMMON FIX',
  'PARTS NEEDED',
  'SPECIAL TOOLS REQUIRED',
  'SAFETY WARNING',
  'DIAGNOSTIC PHASE',
  'REPAIR PHASE',
  'PM NOTE',
  'PARTS REFERENCE',
] as const

export interface DiagnosticSection {
  heading: string
  body:    string
}

export function splitSections(text: string): DiagnosticSection[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const lines = trimmed.split('\n')
  const sections: DiagnosticSection[] = []
  let heading = ''
  let buffer: string[] = []

  const flush = () => {
    const body = buffer.join('\n').trim()
    if (heading || body) sections.push({ heading, body })
    buffer = []
  }

  for (const line of lines) {
    // Strip a leading warning glyph, bullet or markdown emphasis before testing —
    // the model routinely writes "⚠ SAFETY WARNING — ...:" and that block is the
    // single most important one to recognise.
    const candidate = line.trim().replace(/^[^\p{L}]+/u, '')
    const match = /^([A-Z][A-Z0-9 /&—-]{2,}?)\s*(?:—[^:]*)?:\s*(.*)$/u.exec(candidate)
    // Only treat a line as a header when it is one of ours, possibly with a
    // trailing qualifier (the parts section carries a manufacturer suffix).
    const isHeader =
      match !== null &&
      HD_SECTION_HEADERS.some((h) => match[1].trim().startsWith(h))

    if (isHeader && match) {
      flush()
      // Keep the model's own wording, minus the glyph, so a qualified header
      // like "SAFETY WARNING — DPF SYSTEM PRESSURE HAZARD" survives intact.
      heading = candidate.slice(0, candidate.indexOf(':')).trim()
      if (match[2]) buffer.push(match[2])
    } else {
      buffer.push(line)
    }
  }
  flush()

  return sections
}

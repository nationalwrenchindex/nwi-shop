// SERVER-ONLY. Shared Gemini client for every diagnostic engine in NWI Shop.
// Ported from national_wrench_index/src/lib/gemini/client.ts — same model id and
// timeout, so prompts proven there behave identically here.
//
// GEMINI_API_KEY may be unset. Every caller must check isGeminiConfigured()
// first and degrade to a clear "not configured" response rather than throwing a
// 500 at a tech standing next to a truck.

import { GoogleGenAI } from '@google/genai'

const MODEL_ID = 'gemini-3.6-flash'
const GEMINI_TIMEOUT_MS = 55_000

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  return new GoogleGenAI({ apiKey })
}

// gemini-3.6 requires the `googleSearch` grounding tool for grounded calls.
const GROUNDING_TOOL = { googleSearch: {} }

export interface GeminiResult {
  text: string
  /** Deduped grounding source URLs, so a diagnostic can cite where it came from. */
  citations: string[]
}

/** Grounded generation — the model may search. Use for diagnostics. */
export async function generateDiagnostic(
  prompt: string,
  systemInstruction: string,
): Promise<GeminiResult> {
  const client = getClient()

  const response = await client.models.generateContent({
    model: MODEL_ID,
    contents: prompt,
    config: {
      systemInstruction,
      tools: [GROUNDING_TOOL],
      httpOptions: { timeout: GEMINI_TIMEOUT_MS },
    },
  })

  const citations: string[] = Array.from(
    new Set(
      (response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
        .map((c: { web?: { uri?: string } }) => c.web?.uri)
        .filter((u): u is string => typeof u === 'string' && u.length > 0),
    ),
  )

  return { text: response.text ?? '', citations }
}

/**
 * Ungrounded generation. Use for reshaping, structured-JSON extraction and copy
 * generation — anywhere injecting outside web content would be wrong.
 */
export async function generateText(
  prompt: string,
  systemInstruction: string,
  opts: { maxOutputTokens?: number } = {},
): Promise<string> {
  const client = getClient()

  const response = await client.models.generateContent({
    model: MODEL_ID,
    contents: prompt,
    config: {
      systemInstruction,
      ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      httpOptions: { timeout: GEMINI_TIMEOUT_MS },
    },
  })

  return response.text ?? ''
}

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY
}

export const GEMINI_MODEL_ID = MODEL_ID

/** Standard shape for a route that cannot run because the key is absent. */
export function geminiNotConfigured(): Response {
  return Response.json(
    {
      error:
        'Diagnostics are not configured for this deployment. GEMINI_API_KEY is not set.',
      code: 'gemini_not_configured',
    },
    { status: 503 },
  )
}

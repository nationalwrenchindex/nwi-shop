// Lazily constructed Anthropic client for Foreman AI. Returns null when the key
// is unset so every caller degrades to "AI unavailable" instead of crashing —
// Foreman AI is a paid add-on and most shops will not have it enabled.

import Anthropic from '@anthropic-ai/sdk'

/** Model id used for every Foreman AI call. */
export const FOREMAN_AI_MODEL = 'claude-sonnet-5'

let client: Anthropic | null = null

export function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  if (!client) client = new Anthropic({ apiKey })
  return client
}

/** True when Foreman AI can actually reach the API. */
export function anthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

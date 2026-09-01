// SERVER-ONLY. Social post drafting for NWI Shop.
//
// =====================================================================
// THIS IS A REWRITE, NOT A PORT.
//
// The National Wrench Index Suite has a social generator at
// src/lib/social/generate.ts. Its SYSTEM_PROMPT is hardcoded to one
// specific human being: it names the founder, his city, his tenure, his
// exact beta-subscriber count and his $19/month price, and the Suite cron
// then generated that same founder-voice content for EVERY subscriber.
// Copying it here would put a shop owner's name on someone else's story
// and put false pricing and false subscriber claims in their feed.
//
// So the prompt below is built entirely from the shop's OWN record —
// business name, city/state, what kind of work they do, their labor rate,
// their services. No individual is ever named unless that name came out of
// the shop's own profile. No metrics, no testimonials, no pricing claims.
// The truthfulness rules are the one thing worth keeping from the Suite,
// and they are kept.
// =====================================================================
//
// IMAGES: the Suite generated images with OpenAI `gpt-image-1`. There is no
// image provider configured for this deployment and no key for one, so this
// module produces an `image_prompt` the shop can paste into whatever image
// tool they already use, and leaves `image_url` null. It does not pretend to
// have made a picture.

import { generateText, isGeminiConfigured } from '@/lib/gemini'
import { FOREMAN_AI_MODEL, getAnthropic } from '@/lib/anthropic'
import type { ShopProfile, ShopType } from '@/lib/types'

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export type SocialPlatform = 'tiktok' | 'instagram' | 'facebook' | 'linkedin' | 'twitter'

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  'tiktok',
  'instagram',
  'facebook',
  'linkedin',
  'twitter',
] as const

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  tiktok:    'TikTok',
  instagram: 'Instagram',
  facebook:  'Facebook',
  linkedin:  'LinkedIn',
  twitter:   'X / Twitter',
}

export type SocialPostStatus = 'pending' | 'approved' | 'posted' | 'discarded'

export const SOCIAL_POST_STATUSES: readonly SocialPostStatus[] = [
  'pending',
  'approved',
  'posted',
  'discarded',
] as const

export const STATUS_LABELS: Record<SocialPostStatus, string> = {
  pending:   'Needs review',
  approved:  'Approved',
  posted:    'Marked posted',
  discarded: 'Discarded',
}

/** Row shape of `shop_social_posts` (migration 009). */
export interface ShopSocialPost {
  id:                string
  shop_id:           string
  platform:          SocialPlatform
  content:           string
  visual_suggestion: string | null
  image_prompt:      string | null
  image_url:         string | null
  theme:             string | null
  status:            SocialPostStatus
  tech_id:           string | null
  created_at:        string
  updated_at:        string | null
}

/** What the model returns, before it is written to the table. */
export interface SocialPostDraft {
  platform:          SocialPlatform
  content:           string
  visual_suggestion: string
  image_prompt:      string
  theme:             string
}

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(value)
}

export function isSocialPostStatus(value: unknown): value is SocialPostStatus {
  return typeof value === 'string' && (SOCIAL_POST_STATUSES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Images — deliberately unavailable
// ---------------------------------------------------------------------------

/**
 * No image provider is configured for NWI Shop and no key exists for one, so
 * every generated post carries an `image_prompt` and a null `image_url`. This
 * is a constant rather than an env check because there is no env var that
 * would turn it on — wiring an image provider is a code change, not config.
 */
export const IMAGE_GENERATION_AVAILABLE = false

export const IMAGE_GENERATION_NOTE =
  'No image generator is connected to this deployment. Each post includes an image prompt you can paste into whatever image tool you already use — nothing is generated for you.'

/**
 * NWI Shop has no integration with TikTok, Instagram, Facebook, LinkedIn or X.
 * Approving a post marks it ready for a human to publish by hand. Nothing here
 * ever publishes anything.
 */
export const NO_AUTOPUBLISH_NOTE =
  'NWI Shop is not connected to any social network. Approving a post does not publish it — copy the text into the app yourself.'

// ---------------------------------------------------------------------------
// Themes — a weekly rotation that works for any shop, naming no one
// ---------------------------------------------------------------------------

const THEMES: Record<number, string> = {
  0: 'Week in review and what the shop has coming up',
  1: 'Service spotlight — one thing the shop does and why it matters',
  2: 'Maintenance tip a vehicle owner can act on this week',
  3: 'Behind the scenes: how the work actually gets done here',
  4: 'Answering a question customers ask all the time',
  5: 'Seasonal or weather-driven service reminder',
  6: 'Local presence — who this shop serves and where',
}

export function themeForDate(date: Date = new Date()): string {
  return THEMES[date.getDay()] ?? THEMES[1]
}

// ---------------------------------------------------------------------------
// Default service lists per shop type. Used only when the shop has not written
// its own list — they describe the WORK, never a specific business.
// ---------------------------------------------------------------------------

const DEFAULT_SERVICES: Record<ShopType, string[]> = {
  ld: [
    'oil and filter service',
    'brake service',
    'tires and alignment',
    'batteries and charging systems',
    'engine diagnostics',
    'A/C service',
    'suspension and steering',
  ],
  hd: [
    'preventive maintenance services',
    'DOT inspections',
    'air brake and trailer ABS work',
    'reefer unit service',
    'aftertreatment and emissions diagnostics',
    'electrical and charging systems',
    'roadside and shop-based heavy repair',
  ],
  full_service: [
    'oil and filter service',
    'brake service across light and heavy duty',
    'DOT inspections',
    'tires and alignment',
    'engine and electrical diagnostics',
    'preventive maintenance programs',
    'fleet service contracts',
  ],
}

const SHOP_TYPE_DESCRIPTION: Record<ShopType, string> = {
  ld:           'a light-duty repair shop working on passenger cars, SUVs and pickups',
  hd:           'a heavy-duty repair shop working on commercial trucks, trailers and fleet equipment',
  full_service: 'a full-service shop working on both passenger vehicles and commercial trucks',
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export interface SocialPromptInput {
  businessName: string
  city:         string | null
  state:        string | null
  shopType:     ShopType
  laborRate:    number | null
  /** The shop's own service list. Falls back to the shop-type default. */
  services:     string[]
  theme:        string
  dayName:      string
}

/** Everything the prompt needs, read off the shop's own row. */
export function promptInputForShop(
  shop: Pick<ShopProfile, 'business_name' | 'city' | 'state' | 'labor_rate'>,
  shopType: ShopType,
  services: string[] = [],
  now: Date = new Date(),
): SocialPromptInput {
  const cleaned = services.map((s) => s.trim()).filter((s) => s.length > 0)
  return {
    businessName: shop.business_name?.trim() || 'this shop',
    city:         shop.city?.trim() || null,
    state:        shop.state?.trim() || null,
    shopType,
    laborRate:    Number.isFinite(Number(shop.labor_rate)) ? Number(shop.labor_rate) : null,
    services:     cleaned.length ? cleaned : DEFAULT_SERVICES[shopType],
    theme:        themeForDate(now),
    dayName:      ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()],
  }
}

function locationLine(input: SocialPromptInput): string {
  if (input.city && input.state) return `${input.city}, ${input.state}`
  if (input.city) return input.city
  if (input.state) return input.state
  return 'its local service area'
}

export function buildSocialSystemPrompt(input: SocialPromptInput): string {
  const location = locationLine(input)
  const rateLine = input.laborRate
    ? `- The shop's posted labor rate is $${input.laborRate}/hour. You may reference that it charges an hourly labor rate, but never quote a total price for a repair — parts and time vary by vehicle.`
    : `- No labor rate is on file. Do not quote prices of any kind.`

  return `You write social media copy on behalf of ${input.businessName}, ${SHOP_TYPE_DESCRIPTION[input.shopType]} serving ${location}.

You are writing AS the shop, in first person plural ("we", "our shop", "our techs"). The reader is a current or prospective customer.

━━━ FACTS YOU MAY USE — THIS IS THE WHOLE LIST ━━━
- Business name: ${input.businessName}
- Location: ${location}
- Type of work: ${SHOP_TYPE_DESCRIPTION[input.shopType]}
- Services offered: ${input.services.join(', ')}
${rateLine}

━━━ ABSOLUTE RULES ━━━
- Everything you write must be supported by the facts above. Nothing else is known about this shop.
- NEVER invent a person. Do not name an owner, a founder, a technician or a customer. Do not invent a years-in-business figure, a founding story, a family history or a personal background.
- NEVER invent metrics: no customer counts, no job counts, no review counts, no star ratings, no "hundreds of", no "fastest growing", no awards, no certifications.
- NEVER write a testimonial, a quote from a customer, or anything that implies social proof.
- NEVER invent prices, monthly fees, packages, promotions, discounts, coupons, or guarantees.
- NEVER invent hours of operation, a phone number, an address, a website or a booking link. If a call to action needs a contact method, phrase it generically ("give us a call", "message us", "stop by").
- NEVER claim a certification, licence or manufacturer affiliation.
- Do not mention any software vendor or platform. The shop is the author; the tool that drafted this is invisible.
- Write plainly. No hype, no fake urgency, no all-caps shouting.
- If a theme would require a fact you do not have, write about the WORK instead — the service, the symptom, the maintenance interval, the thing a customer should watch for. Real, useful, specific-to-the-trade content is always available without inventing anything.

━━━ PLATFORM REQUIREMENTS ━━━
- tiktok: A spoken hook under 60 seconds. Open with one bold sentence or question, then 2-3 fast points, then a plain call to action. Light emoji use is fine. No hashtags in the body.
- instagram: 80-150 word caption. Lead with the customer's problem. End with 8-12 relevant hashtags on their own final line, each starting with #.
- facebook: 2-3 short conversational paragraphs. Friendly, neighborly. Plain call to action at the end. No URL — you do not know the shop's URL.
- linkedin: 150-250 words, professional register. Angle it at fleet managers, business owners and other trades. Focus on reliability, uptime and cost of downtime.
- twitter: Under 250 characters total including hashtags. One sharp idea. End with 2-3 hashtags.

━━━ VISUAL SUGGESTION ━━━
For each post, write a visual_suggestion: 1-2 sentences telling the shop what to photograph or film in their own bay to go with this post. It must be something they can actually shoot — a part on a bench, a lift, a diagnostic screen, a tech's hands. Never suggest stock imagery of people who do not exist.

━━━ IMAGE PROMPT ━━━
For each post, write an image_prompt: a detailed prompt the shop can paste into an image generator. Style for all of them:
- Real shop environment, natural or work-light lighting, photorealistic, clean and professional
- Subject matter appropriate to ${SHOP_TYPE_DESCRIPTION[input.shopType]}
- No text rendered in the image, no logos, no recognizable faces, no license plates
- Include the aspect ratio: tiktok 9:16 vertical, instagram 1:1 square, facebook 16:9 horizontal, linkedin 16:9 horizontal, twitter 16:9 horizontal

━━━ RESPONSE FORMAT ━━━
Respond with raw JSON only. No markdown fences, no preamble, no trailing commentary. The first character must be [ and the last must be ].
Return exactly 5 objects, one per platform, in this order: tiktok, instagram, facebook, linkedin, twitter.
Each object must match this schema exactly:
{"platform":"tiktok","content":"...","visual_suggestion":"...","image_prompt":"..."}`
}

export function buildSocialUserPrompt(input: SocialPromptInput): string {
  return `Today is ${input.dayName}. Write one post for each of the five platforms on this theme:

"${input.theme}"

Ground every post in the services listed in your instructions. If the theme points at a fact you were not given, write about the work itself instead — do not invent the fact.`
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export type SocialProvider = 'gemini' | 'anthropic'

export type GenerateResult =
  | { ok: true;  drafts: SocialPostDraft[]; provider: SocialProvider }
  | { ok: false; error: string; code: 'no_provider' | 'provider_error' | 'unparseable' }

/**
 * True when at least one text provider can be reached. Gemini is preferred
 * because the Suite's copy prompts were tuned against it; Anthropic is the
 * fallback that actually works in this deployment today, since GEMINI_API_KEY
 * is not set and ANTHROPIC_API_KEY is.
 */
export function socialProviderAvailable(): SocialProvider | null {
  if (isGeminiConfigured()) return 'gemini'
  if (getAnthropic()) return 'anthropic'
  return null
}

const MAX_OUTPUT_TOKENS = 8_000

async function runProvider(
  provider: SocialProvider,
  system: string,
  user: string,
): Promise<string> {
  if (provider === 'gemini') {
    return generateText(user, system, { maxOutputTokens: MAX_OUTPUT_TOKENS })
  }

  const client = getAnthropic()
  if (!client) throw new Error('Anthropic client unavailable')

  const response = await client.messages.create({
    model:      FOREMAN_AI_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages:   [{ role: 'user', content: user }],
  })

  return response.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

/**
 * Scans for the outermost balanced JSON array, so a model that wraps its
 * answer in prose or fences still parses. String-aware, so a bracket inside a
 * caption does not end the scan early.
 */
function extractOutermostArray(text: string): string | null {
  const start = text.indexOf('[')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseDrafts(raw: string, theme: string): SocialPostDraft[] | null {
  const stripped = raw.replace(/```(?:json|JSON)?/g, '').trim()
  const extracted = extractOutermostArray(stripped)
  if (!extracted) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(extracted)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

  const drafts: SocialPostDraft[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    if (!isSocialPlatform(row.platform)) continue
    const content = asString(row.content)
    if (!content) continue

    drafts.push({
      platform:          row.platform,
      content,
      visual_suggestion: asString(row.visual_suggestion),
      image_prompt:      asString(row.image_prompt),
      theme,
    })
  }

  return drafts.length ? drafts : null
}

/**
 * Drafts one post per platform for a shop. Never throws — every failure comes
 * back as a typed result so the route can say what actually went wrong.
 */
export async function generateSocialDrafts(input: SocialPromptInput): Promise<GenerateResult> {
  const provider = socialProviderAvailable()
  if (!provider) {
    return {
      ok:    false,
      code:  'no_provider',
      error:
        'No text generation provider is configured. Set GEMINI_API_KEY or ANTHROPIC_API_KEY for this deployment.',
    }
  }

  const system = buildSocialSystemPrompt(input)
  const user = buildSocialUserPrompt(input)

  let raw = ''
  try {
    raw = await runProvider(provider, system, user)
  } catch (err) {
    console.error('[social] provider error:', err instanceof Error ? err.message : String(err))
    return {
      ok:    false,
      code:  'provider_error',
      error: 'The writing service did not respond. Try again in a moment.',
    }
  }

  const drafts = parseDrafts(raw, input.theme)
  if (!drafts) {
    console.error('[social] could not parse a post array from the model response')
    return {
      ok:    false,
      code:  'unparseable',
      error: 'The writing service returned something we could not read. Try generating again.',
    }
  }

  return { ok: true, drafts, provider }
}

// ---------------------------------------------------------------------------
// Table-missing detection. Migration 009 creates shop_social_posts; until it is
// applied the page must say so rather than throw.
// ---------------------------------------------------------------------------

/** Postgres `undefined_table`, and PostgREST's schema-cache miss for the same. */
export function isMissingTable(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code ?? ''
  return code === '42P01' || code === 'PGRST205'
}

export const MISSING_TABLE_MESSAGE =
  'The social posts table has not been created in this database yet. Apply the pending migration and reload.'

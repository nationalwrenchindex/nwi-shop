// Client-safe plan metadata. Deliberately imports NOTHING from lib/stripe.ts so a
// pricing card can render in a client component without dragging the Stripe SDK —
// or the secret key — into the browser bundle.
//
// ===========================================================================
// FOREMAN AI IS NEVER BUNDLED INTO A PLAN.
// It is a separate $59/mo product and always its own Stripe line item. Elite
// does not "include" it — TIER_LIMITS.elite.foremanAi === true only means an
// Elite shop is ALLOWED TO PURCHASE it. Starter and Pro cannot buy it at all.
// Do not fold this price into a tier price, and do not list it as a tier
// feature bullet. Billing, the pricing page and the webhook all depend on it
// staying a distinct subscription item.
// ===========================================================================

import { FOREMAN_AI_PRICE, TIER_LABELS, TIER_LIMITS, TIER_PRICES } from '@/lib/permissions'
import type { ShopTier } from '@/lib/types'

/** The three tiers in display order — cheapest first. */
export const SHOP_TIERS: readonly ShopTier[] = ['starter', 'pro', 'elite'] as const

export interface ShopPlan {
  tier: ShopTier
  label: string
  /** Monthly price in whole US dollars. */
  price: number
  /** Name of the env var holding this plan's Stripe price id. */
  priceEnvVar: string
  /** One-line positioning under the plan name. */
  tagline: string
  /** Feature bullets, derived from TIER_LIMITS so limits are stated in one place. */
  features: string[]
  /** True when a shop on this tier may purchase the Foreman AI add-on separately. */
  foremanAiAvailable: boolean
  /** The middle tier gets the visual emphasis on the pricing grid. */
  highlight: boolean
}

function limitText(limit: number | null, singular: string, plural: string): string {
  if (limit === null) return `Unlimited ${plural}`
  return `Up to ${limit} ${limit === 1 ? singular : plural}`
}

function featuresFor(tier: ShopTier): string[] {
  const limits = TIER_LIMITS[tier]
  const bullets = [
    limitText(limits.techs, 'tech', 'techs'),
    limitText(limits.bays, 'bay', 'bays'),
    limitText(limits.mobileUnits, 'mobile unit', 'mobile units'),
    'Full inventory for the shop and every service vehicle',
    'Visual bay job board',
    'Built-in tech timeclock',
    'Professional invoicing',
  ]
  if (limits.fleetPro) bullets.push('Fleet Pro integration')
  // NOTE: foremanAi is intentionally NOT pushed as a plan feature. See the header.
  return bullets
}

export const SHOP_PLANS: Record<ShopTier, ShopPlan> = {
  starter: {
    tier: 'starter',
    label: TIER_LABELS.starter,
    price: TIER_PRICES.starter,
    priceEnvVar: 'STRIPE_PRICE_SHOP_STARTER',
    tagline: 'One shop, a small crew, and a truck on the road.',
    features: featuresFor('starter'),
    foremanAiAvailable: TIER_LIMITS.starter.foremanAi,
    highlight: false,
  },
  pro: {
    tier: 'pro',
    label: TIER_LABELS.pro,
    price: TIER_PRICES.pro,
    priceEnvVar: 'STRIPE_PRICE_SHOP_PRO',
    tagline: 'A full floor running multiple bays and a mobile fleet.',
    features: featuresFor('pro'),
    foremanAiAvailable: TIER_LIMITS.pro.foremanAi,
    highlight: true,
  },
  elite: {
    tier: 'elite',
    label: TIER_LABELS.elite,
    price: TIER_PRICES.elite,
    priceEnvVar: 'STRIPE_PRICE_SHOP_ELITE',
    tagline: 'No ceilings, plus Fleet Pro and access to Foreman AI.',
    features: featuresFor('elite'),
    foremanAiAvailable: TIER_LIMITS.elite.foremanAi,
    highlight: false,
  },
}

/** Ordered array form, for mapping over pricing cards. */
export const SHOP_PLAN_LIST: ShopPlan[] = SHOP_TIERS.map((tier) => SHOP_PLANS[tier])

// ---------------------------------------------------------------------------
// Foreman AI — a separate product, never a tier feature.
// ---------------------------------------------------------------------------

export const FOREMAN_AI_ADDON = {
  label: 'Foreman AI',
  price: FOREMAN_AI_PRICE,
  priceEnvVar: 'STRIPE_PRICE_SHOP_FOREMAN_AI',
  tagline: 'Add-on — billed separately, never bundled into a plan.',
  description:
    'An AI shop foreman that reads the job, the vehicle history and the parts on hand, then tells your tech where to start.',
  features: [
    'Diagnostic direction on any open job',
    'Reads vehicle history and prior repairs',
    'Suggests parts from your own inventory',
    'Requires an active NWI Shop Elite plan',
  ],
} as const

/** True when the tier may add Foreman AI. Only Elite may. */
export function canBuyForemanAi(tier: ShopTier): boolean {
  return TIER_LIMITS[tier].foremanAi
}

// ---------------------------------------------------------------------------
// Stripe price id resolution.
//
// Each getter returns `undefined` when its env var is unset. An unset price id
// means that product simply cannot be purchased yet — callers must surface a
// clear "not available" error rather than sending a checkout request to Stripe
// with an empty price, which fails with an opaque API error.
// ---------------------------------------------------------------------------

export function priceIdFor(tier: ShopTier): string | undefined {
  const raw =
    tier === 'starter'
      ? process.env.STRIPE_PRICE_SHOP_STARTER
      : tier === 'pro'
        ? process.env.STRIPE_PRICE_SHOP_PRO
        : process.env.STRIPE_PRICE_SHOP_ELITE
  return raw && raw.length > 0 ? raw : undefined
}

export function foremanAiPriceId(): string | undefined {
  const raw = process.env.STRIPE_PRICE_SHOP_FOREMAN_AI
  return raw && raw.length > 0 ? raw : undefined
}

/** Reverse lookup: which tier does this Stripe price id belong to? */
export function tierFromPriceId(priceId: string): ShopTier | null {
  for (const tier of SHOP_TIERS) {
    if (priceIdFor(tier) === priceId) return tier
  }
  return null
}

/** True when the price id is the Foreman AI add-on rather than a plan. */
export function isForemanAiPriceId(priceId: string): boolean {
  const id = foremanAiPriceId()
  return id !== undefined && id === priceId
}

/** Narrows an untrusted string (a `?plan=` query param) to a real tier. */
export function parseTier(value: string | null | undefined): ShopTier | null {
  if (value === 'starter' || value === 'pro' || value === 'elite') return value
  return null
}

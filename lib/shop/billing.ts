// Client-safe plan metadata. Deliberately imports NOTHING from lib/stripe.ts so a
// pricing card can render in a client component without dragging the Stripe SDK —
// or the secret key — into the browser bundle.
//
// ===========================================================================
// A PLAN IS (SHOP TYPE x TIER), NOT A TIER ALONE.
// Price and Stripe price id both depend on the pair. LD and HD share one price
// book and one set of Stripe price ids; full service is billed on its own,
// higher price book with its own STRIPE_PRICE_SHOP_FS_* ids. Every dollar
// figure here comes from priceFor() in lib/permissions.ts — no price is ever
// written twice.
//
// tierFromPriceId(priceId) -> { shopType, tier } | null
//   The reverse lookup the Stripe webhook calls. Because LD and HD share their
//   price ids, a shared id resolves to shopType 'ld' — the representative of
//   that shared price book, NOT proof the shop is light duty. A price id only
//   distinguishes "full service price book" from "LD/HD price book". A caller
//   that needs the shop's real type must read shop_profiles.shop_type; use this
//   result for the tier, and for which price book was purchased.
// ===========================================================================
//
// ===========================================================================
// FOREMAN AI IS NEVER BUNDLED INTO A PLAN.
// It is a separate $59/mo product and always its own Stripe line item — for
// every shop type, full service included. Elite does not "include" it —
// TIER_LIMITS.elite.foremanAi === true only means an Elite shop is ALLOWED TO
// PURCHASE it. Starter and Pro cannot buy it at all. Do not fold this price
// into a tier price, and do not list it as a tier feature bullet. Billing, the
// pricing page and the webhook all depend on it staying a distinct
// subscription item.
// ===========================================================================

import {
  FEATURE_LABELS,
  FEATURES_BY_TYPE,
  FOREMAN_AI_PRICE,
  SHOP_TYPE_LABELS,
  TIER_LABELS,
  TIER_LIMITS,
  priceFor,
  usesFullServicePricing,
} from '@/lib/permissions'
import type { ShopTier, ShopType } from '@/lib/types'

/** The three tiers in display order — cheapest first. */
export const SHOP_TIERS: readonly ShopTier[] = ['starter', 'pro', 'elite'] as const

/**
 * Every shop type, in plan-generation order. NOT a display order — a public
 * surface iterates PUBLIC_SHOP_TYPES, which omits full service on purpose.
 */
export const SHOP_TYPES: readonly ShopType[] = ['ld', 'hd', 'full_service'] as const

export interface ShopPlan {
  shopType: ShopType
  tier: ShopTier
  label: string
  /** Monthly price in whole US dollars, on this shop type's price book. */
  price: number
  /** Name of the env var holding this plan's Stripe price id. */
  priceEnvVar: string
  /** One-line positioning under the plan name. */
  tagline: string
  /**
   * Bullets identical for every shop type — the tier limits and the product
   * itself. A surface that presents the diagnostic tools separately (the public
   * pricing grid quotes both public types side by side) renders these and then
   * the tools on their own.
   */
  sharedFeatures: string[]
  /** The one bullet naming the diagnostic tools this shop type unlocks. */
  toolsFeature: string
  /** Full bullet list: sharedFeatures plus toolsFeature. */
  features: string[]
  /** True when a shop on this tier may purchase the Foreman AI add-on separately. */
  foremanAiAvailable: boolean
  /** The middle tier gets the visual emphasis on the pricing grid. */
  highlight: boolean
}

const TAGLINES: Record<ShopTier, string> = {
  starter: 'One shop, a small crew, and a truck on the road.',
  pro:     'A full floor running multiple bays and a mobile fleet.',
  elite:   'No ceilings, plus Fleet Pro and access to Foreman AI.',
}

function limitText(limit: number | null, singular: string, plural: string): string {
  if (limit === null) return `Unlimited ${plural}`
  return `Up to ${limit} ${limit === 1 ? singular : plural}`
}

/** Limit + product bullets. The same for every shop type. */
function sharedFeaturesFor(tier: ShopTier): string[] {
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

/** Comma-joined tool names for a shop type, straight from the feature catalog. */
export function toolNamesFor(shopType: ShopType): string {
  return FEATURES_BY_TYPE[shopType].map((feature) => FEATURE_LABELS[feature]).join(', ')
}

/** The diagnostic-tools bullet — the one plan line that differs by shop type. */
export function toolsFeatureFor(shopType: ShopType): string {
  return `${SHOP_TYPE_LABELS[shopType]} diagnostics: ${toolNamesFor(shopType)}`
}

// ---------------------------------------------------------------------------
// Stripe price id resolution.
//
// Each getter returns `undefined` when its env var is unset. An unset price id
// means that product simply cannot be purchased yet — callers must surface a
// clear "not available" error rather than sending a checkout request to Stripe
// with an empty price, which fails with an opaque API error.
//
// LD and HD are the same purchase at the same price, so they share the original
// STRIPE_PRICE_SHOP_* vars — those products already exist on the live Stripe
// account and must not be duplicated. Full service reads its own FS vars.
// ---------------------------------------------------------------------------

const SHARED_PRICE_ENV_VARS: Record<ShopTier, string> = {
  starter: 'STRIPE_PRICE_SHOP_STARTER',
  pro:     'STRIPE_PRICE_SHOP_PRO',
  elite:   'STRIPE_PRICE_SHOP_ELITE',
}

const FULL_SERVICE_PRICE_ENV_VARS: Record<ShopTier, string> = {
  starter: 'STRIPE_PRICE_SHOP_FS_STARTER',
  pro:     'STRIPE_PRICE_SHOP_FS_PRO',
  elite:   'STRIPE_PRICE_SHOP_FS_ELITE',
}

/** Which env var holds the Stripe price id for this (shop type, tier). */
export function priceEnvVarFor(shopType: ShopType, tier: ShopTier): string {
  return usesFullServicePricing(shopType)
    ? FULL_SERVICE_PRICE_ENV_VARS[tier]
    : SHARED_PRICE_ENV_VARS[tier]
}

export function priceIdFor(shopType: ShopType, tier: ShopTier): string | undefined {
  // Read literally rather than by computed key: the bundler only substitutes
  // process.env references it can see spelled out.
  const raw = usesFullServicePricing(shopType)
    ? tier === 'starter'
      ? process.env.STRIPE_PRICE_SHOP_FS_STARTER
      : tier === 'pro'
        ? process.env.STRIPE_PRICE_SHOP_FS_PRO
        : process.env.STRIPE_PRICE_SHOP_FS_ELITE
    : tier === 'starter'
      ? process.env.STRIPE_PRICE_SHOP_STARTER
      : tier === 'pro'
        ? process.env.STRIPE_PRICE_SHOP_PRO
        : process.env.STRIPE_PRICE_SHOP_ELITE
  return raw && raw.length > 0 ? raw : undefined
}

// ---------------------------------------------------------------------------
// The plan catalog
// ---------------------------------------------------------------------------

function buildPlan(shopType: ShopType, tier: ShopTier): ShopPlan {
  const sharedFeatures = sharedFeaturesFor(tier)
  const toolsFeature = toolsFeatureFor(shopType)
  return {
    shopType,
    tier,
    label: TIER_LABELS[tier],
    price: priceFor(shopType, tier),
    priceEnvVar: priceEnvVarFor(shopType, tier),
    tagline: TAGLINES[tier],
    sharedFeatures,
    toolsFeature,
    features: [...sharedFeatures, toolsFeature],
    foremanAiAvailable: TIER_LIMITS[tier].foremanAi,
    highlight: tier === 'pro',
  }
}

function buildTypePlans(shopType: ShopType): Record<ShopTier, ShopPlan> {
  return {
    starter: buildPlan(shopType, 'starter'),
    pro:     buildPlan(shopType, 'pro'),
    elite:   buildPlan(shopType, 'elite'),
  }
}

/** Every plan, keyed [shopType][tier]. */
export const SHOP_PLANS: Record<ShopType, Record<ShopTier, ShopPlan>> = {
  ld:           buildTypePlans('ld'),
  hd:           buildTypePlans('hd'),
  full_service: buildTypePlans('full_service'),
}

export function planFor(shopType: ShopType, tier: ShopTier): ShopPlan {
  return SHOP_PLANS[shopType][tier]
}

/** Ordered array form for one shop type, for mapping over pricing cards. */
export function planListFor(shopType: ShopType): ShopPlan[] {
  return SHOP_TIERS.map((tier) => planFor(shopType, tier))
}

/**
 * The price book the public marketing page quotes. LD and HD share one, so
 * either yields the same 119/199/299. Full service is deliberately unlisted and
 * must never be quoted on a public page — see PUBLIC_SHOP_TYPES.
 */
export const PUBLIC_PRICING_SHOP_TYPE: ShopType = 'ld'

/** The public price book keyed by tier, for one-off references in copy. */
export const PUBLIC_PLANS: Record<ShopTier, ShopPlan> = SHOP_PLANS[PUBLIC_PRICING_SHOP_TYPE]

/** Ordered public pricing cards — the shared LD/HD price book. */
export const PUBLIC_PLAN_LIST: ShopPlan[] = planListFor(PUBLIC_PRICING_SHOP_TYPE)

// ---------------------------------------------------------------------------
// Foreman AI — a separate product, never a tier feature, for every shop type.
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

export function foremanAiPriceId(): string | undefined {
  const raw = process.env.STRIPE_PRICE_SHOP_FOREMAN_AI
  return raw && raw.length > 0 ? raw : undefined
}

/** What tierFromPriceId resolves a Stripe price id to. */
export interface PlanIdentity {
  /**
   * The price book the id belongs to: 'full_service', or 'ld' standing in for
   * the shared LD/HD book. Never read 'ld' as proof the shop is light duty —
   * shop_profiles.shop_type is the authority on that. See the file header.
   */
  shopType: ShopType
  tier: ShopTier
}

/**
 * Reverse lookup: which (price book, tier) does this Stripe price id belong to?
 *
 * The shared LD/HD book is searched first, so a misconfiguration that points the
 * FS vars at the shared ids resolves to the cheaper book rather than quietly
 * treating a light/heavy duty shop as full service.
 */
export function tierFromPriceId(priceId: string): PlanIdentity | null {
  for (const shopType of ['ld', 'full_service'] as const) {
    for (const tier of SHOP_TIERS) {
      if (priceIdFor(shopType, tier) === priceId) return { shopType, tier }
    }
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

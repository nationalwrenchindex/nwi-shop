// Client-safe role + tier matrix. The single source of truth for what each of the
// three shop roles may see. Server code enforces the same rules again in RLS —
// this exists so the UI never renders a control the request would reject.

import type { ShopRole, ShopTier, ShopType } from '@/lib/types'

export interface Permissions {
  /** Pay rates, payroll export, anything tied to what a person earns. */
  viewPayRates:    boolean
  /** Part cost, margin %, inventory value at cost. */
  viewMargins:     boolean
  runPayroll:      boolean
  /** false means the user is scoped to jobs assigned to them. */
  viewAllJobs:     boolean
  manageBays:      boolean
  manageTechs:     boolean
  manageInventory: boolean
  manageCustomers: boolean
  viewFinancials:  boolean
  manageBilling:   boolean
}

const MANAGER: Permissions = {
  viewPayRates:    true,
  viewMargins:     true,
  runPayroll:      true,
  viewAllJobs:     true,
  manageBays:      true,
  manageTechs:     true,
  manageInventory: true,
  manageCustomers: true,
  viewFinancials:  true,
  manageBilling:   true,
}

// Foreman runs the floor — job board, bays, techs, customers — but never sees
// what anyone is paid or what the shop makes on a part.
const FOREMAN: Permissions = {
  viewPayRates:    false,
  viewMargins:     false,
  runPayroll:      false,
  viewAllJobs:     true,
  manageBays:      true,
  manageTechs:     true,
  manageInventory: true,
  manageCustomers: true,
  viewFinancials:  false,
  manageBilling:   false,
}

// Tech sees their own jobs, their own clock, their own hours. Nothing else.
const TECH: Permissions = {
  viewPayRates:    false,
  viewMargins:     false,
  runPayroll:      false,
  viewAllJobs:     false,
  manageBays:      false,
  manageTechs:     false,
  manageInventory: false,
  manageCustomers: false,
  viewFinancials:  false,
  manageBilling:   false,
}

const MATRIX: Record<ShopRole, Permissions> = {
  manager: MANAGER,
  foreman: FOREMAN,
  tech:    TECH,
}

export function permissionsFor(role: ShopRole): Permissions {
  return MATRIX[role]
}

export function can(role: ShopRole, permission: keyof Permissions): boolean {
  return MATRIX[role][permission]
}

export const ROLE_LABELS: Record<ShopRole, string> = {
  manager: 'Shop Manager',
  foreman: 'Shop Foreman',
  tech:    'Shop Tech',
}

// ---------------------------------------------------------------------------
// Tier limits. `null` means unlimited.
// ---------------------------------------------------------------------------

export interface TierLimits {
  techs:       number | null
  bays:        number | null
  mobileUnits: number | null
  fleetPro:    boolean
  foremanAi:   boolean
}

export const TIER_LIMITS: Record<ShopTier, TierLimits> = {
  starter: { techs: 3,    bays: 2,    mobileUnits: 1,    fleetPro: false, foremanAi: false },
  pro:     { techs: 8,    bays: 6,    mobileUnits: 3,    fleetPro: false, foremanAi: false },
  // Foreman AI is a paid add-on even here — `foremanAi` only means "may purchase".
  elite:   { techs: null, bays: null, mobileUnits: null, fleetPro: true,  foremanAi: true  },
}

export const TIER_LABELS: Record<ShopTier, string> = {
  starter: 'NWI Shop Starter',
  pro:     'NWI Shop Pro',
  elite:   'NWI Shop Elite',
}

/** Monthly price in whole dollars. Foreman AI is always separate at $59/mo. */
export const TIER_PRICES: Record<ShopTier, number> = {
  starter: 119,
  pro:     199,
  elite:   299,
}

export const FOREMAN_AI_PRICE = 59

export function withinLimit(limit: number | null, current: number): boolean {
  return limit === null || current < limit
}

// ---------------------------------------------------------------------------
// Shop type: which diagnostic tools a shop can reach, and which price book it
// is billed on. This is orthogonal to role — role says what a PERSON may do,
// shop type says what the SHOP bought. A manager at an LD shop still cannot
// open the HD tools.
// ---------------------------------------------------------------------------

export type ShopFeature =
  // Shop-type gated: light duty
  | 'quickwrench_ld'
  // Shop-type gated: heavy duty
  | 'quickwrench_hd'
  | 'reefer_alarm_codes'
  | 'trailer_abs'
  | 'epa_608'
  | 'dot_inspections'
  | 'aerial_inspections'
  // Available to every shop type; gated by tier only
  | 'parts_reference'
  | 'torquewrench'
  | 'garage_sync'
  | 'social_posts'
  | 'foreman_ai'
  | 'fleet_pro'

export const FEATURE_LABELS: Record<ShopFeature, string> = {
  quickwrench_ld:     'QuickWrench LD',
  quickwrench_hd:     'QuickWrench HD',
  reefer_alarm_codes: 'Reefer Alarm Codes',
  trailer_abs:        'Trailer ABS',
  epa_608:            'EPA 608 Log',
  dot_inspections:    'DOT Inspections',
  aerial_inspections: 'Aerial Inspections',
  parts_reference:    'Parts Reference',
  torquewrench:       'TorqueWrench Reviews',
  garage_sync:        'NWI Garage Sync',
  social_posts:       'Social Posts',
  foreman_ai:         'Foreman AI',
  fleet_pro:          'Fleet Pro',
}

/** URL segment under /shop/tools for each feature. */
export const FEATURE_SLUGS: Record<ShopFeature, string> = {
  quickwrench_ld:     'quickwrench-ld',
  quickwrench_hd:     'quickwrench-hd',
  reefer_alarm_codes: 'reefer-alarm-codes',
  trailer_abs:        'trailer-abs',
  epa_608:            'epa-608',
  dot_inspections:    'dot-inspections',
  aerial_inspections: 'aerial-inspections',
  parts_reference:    'parts-reference',
  torquewrench:       'torquewrench',
  garage_sync:        'garage-sync',
  social_posts:       'social-posts',
  foreman_ai:         'foreman-ai',
  fleet_pro:          'fleet-pro',
}

const LD_FEATURES: ShopFeature[] = ['quickwrench_ld']

const HD_FEATURES: ShopFeature[] = [
  'quickwrench_hd',
  'reefer_alarm_codes',
  'trailer_abs',
  'epa_608',
  'dot_inspections',
  'aerial_inspections',
]

/**
 * Features every shop gets regardless of what it works on. These are business
 * tools, not diagnostics — a light duty shop needs review requests and a
 * customer portal just as much as a heavy duty one. They are still tier gated.
 */
const TYPE_INDEPENDENT_FEATURES: ShopFeature[] = [
  'parts_reference',
  'torquewrench',
  'garage_sync',
  'social_posts',
  'foreman_ai',
  'fleet_pro',
]

/**
 * What each shop type unlocks, before tier is considered. Full service is
 * derived as "every LD feature plus every HD feature" rather than a hardcoded
 * list, so a feature added to either side is picked up automatically.
 */
export const FEATURES_BY_TYPE: Record<ShopType, ShopFeature[]> = {
  ld:           [...LD_FEATURES, ...TYPE_INDEPENDENT_FEATURES],
  hd:           [...HD_FEATURES, ...TYPE_INDEPENDENT_FEATURES],
  full_service: [...LD_FEATURES, ...HD_FEATURES, ...TYPE_INDEPENDENT_FEATURES],
}

/**
 * Minimum tier for each feature.
 *   starter — core shop operations and compliance paperwork
 *   pro     — the full diagnostic stack
 *   elite   — Fleet Pro and Foreman AI
 */
export const FEATURE_MIN_TIER: Record<ShopFeature, ShopTier> = {
  epa_608:            'starter',
  dot_inspections:    'starter',
  aerial_inspections: 'starter',
  torquewrench:       'starter',
  garage_sync:        'starter',

  quickwrench_ld:     'pro',
  quickwrench_hd:     'pro',
  reefer_alarm_codes: 'pro',
  trailer_abs:        'pro',
  parts_reference:    'pro',
  social_posts:       'pro',

  fleet_pro:          'elite',
  foreman_ai:         'elite',
}

const TIER_RANK: Record<ShopTier, number> = { starter: 0, pro: 1, elite: 2 }

export function tierMeets(tier: ShopTier, minimum: ShopTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[minimum]
}

/** Everything this shop TYPE could unlock, ignoring tier. */
export function featuresFor(shopType: ShopType): ShopFeature[] {
  return FEATURES_BY_TYPE[shopType]
}

/**
 * What this shop can actually reach right now. Both gates must pass: the shop
 * type decides whether the tool is relevant at all, the tier decides whether
 * they have paid for it.
 */
export function availableFeatures(
  shopType: ShopType,
  tier: ShopTier,
): ShopFeature[] {
  return FEATURES_BY_TYPE[shopType].filter((f) =>
    tierMeets(tier, FEATURE_MIN_TIER[f]),
  )
}

export function hasFeature(
  shopType: ShopType,
  tier: ShopTier,
  feature: ShopFeature,
): boolean {
  return (
    FEATURES_BY_TYPE[shopType].includes(feature) &&
    tierMeets(tier, FEATURE_MIN_TIER[feature])
  )
}

/**
 * Why a feature is unavailable — lets the UI say "upgrade to Pro" rather than
 * pretending the tool does not exist, while still never revealing an HD tool
 * to a light duty shop.
 */
export type FeatureBlock = 'available' | 'wrong_shop_type' | 'tier_too_low'

export function featureBlock(
  shopType: ShopType,
  tier: ShopTier,
  feature: ShopFeature,
): FeatureBlock {
  if (!FEATURES_BY_TYPE[shopType].includes(feature)) return 'wrong_shop_type'
  if (!tierMeets(tier, FEATURE_MIN_TIER[feature])) return 'tier_too_low'
  return 'available'
}

export const SHOP_TYPE_LABELS: Record<ShopType, string> = {
  ld:           'Light Duty',
  hd:           'Heavy Duty',
  full_service: 'Full Service',
}

export const SHOP_TYPE_DESCRIPTIONS: Record<ShopType, string> = {
  ld:           'Cars and light trucks. Includes QuickWrench LD diagnostics.',
  hd:           'Class 6-8, trailers and reefers. Includes QuickWrench HD, reefer alarm codes, trailer ABS, EPA 608 and DOT inspections.',
  full_service: 'Everything in Light Duty and Heavy Duty, on one account.',
}

/**
 * Shop types offered on the public signup page. Full service is intentionally
 * absent — it is reachable only via /shop/signup?type=full_service.
 */
export const PUBLIC_SHOP_TYPES: ShopType[] = ['ld', 'hd']

export function isShopType(value: unknown): value is ShopType {
  return value === 'ld' || value === 'hd' || value === 'full_service'
}

// ---------------------------------------------------------------------------
// Price book. LD and HD share one; full service carries its own higher one.
// TIER_PRICES above remains the LD/HD baseline so existing callers keep working.
// ---------------------------------------------------------------------------

export const TIER_PRICES_BY_TYPE: Record<ShopType, Record<ShopTier, number>> = {
  ld:           { starter: 119, pro: 199, elite: 299 },
  hd:           { starter: 119, pro: 199, elite: 299 },
  full_service: { starter: 159, pro: 249, elite: 349 },
}

export function priceFor(shopType: ShopType, tier: ShopTier): number {
  return TIER_PRICES_BY_TYPE[shopType][tier]
}

/** Full service is billed on its own Stripe products, so it needs its own ids. */
export function usesFullServicePricing(shopType: ShopType): boolean {
  return shopType === 'full_service'
}

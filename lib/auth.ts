// SERVER-ONLY session + role resolution. Every /shop page and API route starts
// here: it resolves the signed-in user to their shop_techs record, which is what
// carries the role. No role ever comes from the client.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  availableFeatures,
  featureBlock,
  hasFeature,
  FEATURE_LABELS,
  FEATURE_MIN_TIER,
  permissionsFor,
  type Permissions,
  type ShopFeature,
} from '@/lib/permissions'
import type {
  ShopProfile,
  ShopRole,
  ShopSubscription,
  ShopTech,
  ShopTier,
  ShopType,
} from '@/lib/types'

export interface ShopContext {
  userId:       string
  email:        string | null
  tech:         ShopTech
  shop:         ShopProfile
  subscription: ShopSubscription | null
  role:         ShopRole
  permissions:  Permissions
  /** What kind of work the shop does — gates which tools are relevant. */
  shopType:     ShopType
  /** What the shop pays for — gates which tools are entitled. */
  tier:         ShopTier
  /** Tools reachable right now, after BOTH gates. */
  features:     ShopFeature[]
}

/**
 * Resolves the current request to a shop context, or null when the caller is
 * signed out or not yet attached to a shop.
 */
export async function getShopContext(): Promise<ShopContext | null> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: tech } = await supabase
    .from('shop_techs')
    .select('*')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle<ShopTech>()

  if (!tech) return null

  const { data: shop } = await supabase
    .from('shop_profiles')
    .select('*')
    .eq('id', tech.shop_id)
    .maybeSingle<ShopProfile>()

  if (!shop) return null

  const { data: subscription } = await supabase
    .from('shop_subscriptions')
    .select('*')
    .eq('shop_id', tech.shop_id)
    .maybeSingle<ShopSubscription>()

  // The subscription row is authoritative when present; the profile tier is the
  // fallback for a shop that has not finished checkout.
  const shopType = shop.shop_type ?? 'ld'
  const tier = subscription?.tier ?? shop.subscription_tier ?? 'starter'

  return {
    userId:      user.id,
    email:       user.email ?? null,
    tech,
    shop,
    subscription: subscription ?? null,
    role:        tech.role,
    permissions: permissionsFor(tech.role),
    // A shop row written before the shop_type migration has no value; treat it
    // as light duty rather than crashing or silently unlocking the HD tools.
    shopType,
    tier,
    // Both gates applied: type decides relevance, tier decides entitlement.
    features:    availableFeatures(shopType, tier),
  }
}

/** Server-component guard: returns the context or redirects to /login. */
export async function requireShop(): Promise<ShopContext> {
  const ctx = await getShopContext()
  if (!ctx) redirect('/login')
  return ctx
}

/** Server-component guard for a specific permission. */
export async function requirePermission(
  permission: keyof Permissions,
): Promise<ShopContext> {
  const ctx = await requireShop()
  if (!ctx.permissions[permission]) redirect('/shop')
  return ctx
}

/**
 * Server-component guard for a diagnostic tool. Orthogonal to permissions: this
 * asks what the SHOP bought, not what the person may do. A manager at an LD shop
 * is refused the HD tools.
 */
export async function requireFeature(feature: ShopFeature): Promise<ShopContext> {
  const ctx = await requireShop()
  if (!hasFeature(ctx.shopType, ctx.tier, feature)) redirect('/shop')
  return ctx
}

/** Server-component guard for an explicit set of roles. */
export async function requireRole(...roles: ShopRole[]): Promise<ShopContext> {
  const ctx = await requireShop()
  if (!roles.includes(ctx.role)) redirect('/shop')
  return ctx
}

/**
 * Route-handler guard. Returns either a context or the Response to return —
 * routes must not redirect, so this hands back a 401/403 instead.
 */
export async function apiContext(
  permission?: keyof Permissions,
): Promise<{ ctx: ShopContext; error: null } | { ctx: null; error: Response }> {
  const ctx = await getShopContext()
  if (!ctx) {
    return {
      ctx: null,
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  if (permission && !ctx.permissions[permission]) {
    return {
      ctx: null,
      error: Response.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }
  return { ctx, error: null }
}

/**
 * Route-handler guard for a diagnostic tool, optionally combined with a
 * permission. Kept separate from apiContext so the two gates stay legible at
 * the call site: one is "what the shop bought", the other "what the person may do".
 */
export async function apiFeature(
  feature: ShopFeature,
  permission?: keyof Permissions,
): Promise<{ ctx: ShopContext; error: null } | { ctx: null; error: Response }> {
  const result = await apiContext(permission)
  if (result.error) return result
  if (!hasFeature(result.ctx.shopType, result.ctx.tier, feature)) {
    return {
      ctx: null,
      error: Response.json(
        { error: featureErrorMessage(result.ctx.shopType, result.ctx.tier, feature) },
        { status: 403 },
      ),
    }
  }
  return result
}

/**
 * Distinguishes "your shop type does not do this work" from "upgrade your plan".
 * Kept out of apiFeature's happy path so the two gates stay legible.
 */
function featureErrorMessage(
  shopType: ShopType,
  tier: ShopTier,
  feature: ShopFeature,
): string {
  return featureBlock(shopType, tier, feature) === 'tier_too_low'
    ? `${FEATURE_LABELS[feature]} requires the ${FEATURE_MIN_TIER[feature]} plan or higher.`
    : `${FEATURE_LABELS[feature]} is not included for your shop type.`
}

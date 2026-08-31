// SERVER-ONLY session + role resolution. Every /shop page and API route starts
// here: it resolves the signed-in user to their shop_techs record, which is what
// carries the role. No role ever comes from the client.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { permissionsFor, type Permissions } from '@/lib/permissions'
import type { ShopProfile, ShopRole, ShopSubscription, ShopTech } from '@/lib/types'

export interface ShopContext {
  userId:       string
  email:        string | null
  tech:         ShopTech
  shop:         ShopProfile
  subscription: ShopSubscription | null
  role:         ShopRole
  permissions:  Permissions
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

  return {
    userId:      user.id,
    email:       user.email ?? null,
    tech,
    shop,
    subscription: subscription ?? null,
    role:        tech.role,
    permissions: permissionsFor(tech.role),
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

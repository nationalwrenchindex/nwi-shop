// Signup + checkout. Creates the auth user, the shop, and the owner's manager
// record, then hands the browser a Stripe Checkout URL. The subscription row
// itself is NOT written here — the Stripe webhook owns that, so a subscription
// only ever exists once Stripe says it was paid for.

import { NextResponse } from 'next/server'
import { APP_URL } from '@/lib/branding'
import { SHOP_TYPE_LABELS, isShopType } from '@/lib/permissions'
import {
  SHOP_PLANS,
  canBuyForemanAi,
  foremanAiPriceId,
  parseTier,
  planFor,
  priceIdFor,
} from '@/lib/shop/billing'
import { stripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/service'
import type { ShopType } from '@/lib/types'

interface CheckoutBody {
  plan?: unknown
  shop_type?: unknown
  businessName?: unknown
  ownerName?: unknown
  email?: unknown
  password?: unknown
  phone?: unknown
  foremanAi?: unknown
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: 'Shop', last: 'Owner' }
  if (parts.length === 1) return { first: parts[0], last: '—' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  let body: CheckoutBody
  try {
    body = (await request.json()) as CheckoutBody
  } catch {
    return bad('Invalid request body.')
  }

  const tier = parseTier(str(body.plan))
  if (!tier) return bad('Choose a plan to continue.')

  // Shop type decides both the price book and which diagnostic tools unlock.
  // Any valid ShopType is accepted, full service included. The unlisted
  // /shop/signup?type=full_service link is a MARKETING device, not a security
  // boundary — the server has no way to know which link a browser arrived from,
  // and there is nothing to protect here: full service costs more, not less.
  // Anything that must actually be gated is gated by shop_type in RLS and by
  // requireFeature() on the tools themselves.
  const rawShopType = str(body.shop_type)
  if (rawShopType !== '' && !isShopType(rawShopType)) {
    return bad('Choose the kind of work your shop does to continue.')
  }
  // Absent means light duty — the default an older client sends nothing for.
  const shopType: ShopType = isShopType(rawShopType) ? rawShopType : 'ld'
  const plan = planFor(shopType, tier)

  const businessName = str(body.businessName)
  const ownerName = str(body.ownerName)
  const email = str(body.email).toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  const phone = str(body.phone)
  const wantsForemanAi = body.foremanAi === true

  if (!businessName) return bad('Enter your business name.')
  if (!ownerName) return bad('Enter your name.')
  if (!email || !email.includes('@')) return bad('Enter a valid email address.')
  if (password.length < 8) return bad('Password must be at least 8 characters.')

  // Foreman AI is a separate product and only Elite may add it. Reject rather
  // than silently dropping the line item, so the customer never believes they
  // bought something they did not.
  if (wantsForemanAi && !canBuyForemanAi(tier)) {
    return bad(
      `Foreman AI is an add-on available on ${SHOP_PLANS[shopType].elite.label} only. It is never included in a plan.`,
    )
  }

  // An unset price env var means this plan simply is not purchasable yet. Fail
  // here with a readable message instead of sending Stripe an empty price. Full
  // service reads its own STRIPE_PRICE_SHOP_FS_* vars, so it can be unavailable
  // while the shared LD/HD plans are live.
  const planPriceId = priceIdFor(shopType, tier)
  if (!planPriceId) {
    return bad(
      `${plan.label} for a ${SHOP_TYPE_LABELS[shopType]} shop is not available for purchase right now. Please contact support.`,
      503,
    )
  }

  let addonPriceId: string | undefined
  if (wantsForemanAi) {
    addonPriceId = foremanAiPriceId()
    if (!addonPriceId) {
      return bad('The Foreman AI add-on is not available right now.', 503)
    }
  }

  const supabase = createServiceClient()

  // --- 1. auth user --------------------------------------------------------
  const { data: created, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { business_name: businessName, full_name: ownerName },
  })

  if (userError || !created.user) {
    const message = userError?.message ?? 'Could not create your account.'
    const taken = /already|registered|exists/i.test(message)
    return bad(
      taken ? 'An account with that email already exists. Sign in instead.' : message,
      taken ? 409 : 400,
    )
  }

  const userId = created.user.id

  // Anything that fails past this point leaves an orphaned auth user, so undo it.
  async function rollback() {
    await supabase.auth.admin.deleteUser(userId)
  }

  // --- 2. shop profile -----------------------------------------------------
  const { data: shop, error: shopError } = await supabase
    .from('shop_profiles')
    .insert({
      owner_id: userId,
      business_name: businessName,
      email,
      phone: phone || null,
      subscription_tier: tier,
      shop_type: shopType,
    })
    .select('id')
    .single<{ id: string }>()

  if (shopError || !shop) {
    await rollback()
    return bad(shopError?.message ?? 'Could not create your shop.', 500)
  }

  // --- 3. owner's tech record — always role `manager` ----------------------
  const { first, last } = splitName(ownerName)
  const { error: techError } = await supabase.from('shop_techs').insert({
    shop_id: shop.id,
    user_id: userId,
    first_name: first,
    last_name: last,
    email,
    phone: phone || null,
    role: 'manager',
    active: true,
  })

  if (techError) {
    await supabase.from('shop_profiles').delete().eq('id', shop.id)
    await rollback()
    return bad(techError.message, 500)
  }

  // --- 4. Stripe Checkout --------------------------------------------------
  // Foreman AI is its own line item. It is never merged into the plan price.
  const lineItems: { price: string; quantity: number }[] = [
    { price: planPriceId, quantity: 1 },
  ]
  if (addonPriceId) lineItems.push({ price: addonPriceId, quantity: 1 })

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: lineItems,
      // client_reference_id + metadata both carry the shop id: the webhook reads
      // metadata, and client_reference_id makes it visible in the Stripe UI.
      client_reference_id: shop.id,
      metadata: {
        shop_id: shop.id,
        tier,
        shop_type: shopType,
        foreman_ai: addonPriceId ? 'true' : 'false',
      },
      subscription_data: {
        metadata: {
          shop_id: shop.id,
          tier,
          shop_type: shopType,
          foreman_ai: addonPriceId ? 'true' : 'false',
        },
      },
      allow_promotion_codes: true,
      success_url: `${APP_URL}/shop/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      // Carry the type back so a canceled full service checkout returns to the
      // full service form rather than dropping the visitor onto the LD/HD one.
      cancel_url: `${APP_URL}/shop/signup?plan=${tier}&type=${shopType}&canceled=1`,
    })

    if (!session.url) {
      return bad('Stripe did not return a checkout URL. Please try again.', 502)
    }

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    // The account exists and is usable — they can subscribe from /shop/billing.
    const message = err instanceof Error ? err.message : 'Could not start checkout.'
    return bad(message, 502)
  }
}

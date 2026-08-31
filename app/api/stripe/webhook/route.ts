// Stripe webhook. The signature is verified against the RAW request body — never
// re-serialize request.json() here, the bytes must be byte-identical to what
// Stripe signed. No user session exists on a webhook request, so every database
// write goes through the service-role client.
//
// =====================================================================
// CHARTER MEMBERS ARE PRICE-LOCKED FOREVER.
//
// A subscription with `is_charter_member = true` keeps the price it signed up
// at, permanently. Nothing in this file changes a subscription's price, and
// nothing added to this file ever may.
//
// ANY future price migration, backfill, or bulk `subscriptions.update` MUST
// exclude charter rows — `.eq('is_charter_member', false)` on the Supabase side
// and a matching filter before touching Stripe. If you came here to write a
// price change, that is the one rule.
// =====================================================================

import { headers } from 'next/headers'
import type Stripe from 'stripe'
import { isForemanAiPriceId, tierFromPriceId } from '@/lib/shop/billing'
import { claimCharterSlot } from '@/lib/shop/charter'
import { isShopType } from '@/lib/permissions'
import { stripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/service'
import type { ShopTier, ShopType, SubStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

type ServiceClient = ReturnType<typeof createServiceClient>

function ok(): Response {
  return Response.json({ received: true }, { status: 200 })
}

/** Stripe statuses we do not model collapse onto the nearest SubStatus. */
function toSubStatus(status: Stripe.Subscription.Status): SubStatus {
  switch (status) {
    case 'active':
      return 'active'
    case 'trialing':
      return 'trialing'
    case 'past_due':
    case 'unpaid':
      return 'past_due'
    case 'canceled':
    case 'paused':
      return 'canceled'
    default:
      // incomplete, incomplete_expired
      return 'incomplete'
  }
}

/** Only these statuses grant access to the app. */
function isActiveStatus(status: SubStatus): boolean {
  return status === 'active' || status === 'trialing'
}

function isoOrNull(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
  return new Date(seconds * 1000).toISOString()
}

/**
 * Reads the tier, the price book and the add-on state off the subscription's
 * actual line items.
 *
 * `priceBook` is whatever tierFromPriceId() resolved the plan price to. It is
 * NOT the shop's type: LD and HD share one set of Stripe price ids, so that book
 * comes back as 'ld' for either of them. Only 'full_service' identifies a type
 * outright. resolveShopType() below turns this into something safe to persist.
 */
function readItems(subscription: Stripe.Subscription): {
  tier: ShopTier | null
  priceBook: ShopType | null
  foremanAi: boolean
} {
  let tier: ShopTier | null = null
  let priceBook: ShopType | null = null
  let foremanAi = false

  for (const item of subscription.items.data) {
    const priceId = item.price.id
    if (isForemanAiPriceId(priceId)) {
      // Foreman AI is always its own line item — never folded into a plan price.
      foremanAi = true
      continue
    }
    const matched = tierFromPriceId(priceId)
    if (matched) {
      tier = matched.tier
      priceBook = matched.shopType
    }
  }

  return { tier, priceBook, foremanAi }
}

/** Falls back to metadata when the price ids are not configured in this env. */
function tierFromMetadata(metadata: Stripe.Metadata | null): ShopTier | null {
  const raw = metadata?.tier
  if (raw === 'starter' || raw === 'pro' || raw === 'elite') return raw
  return null
}

/** Checkout stamps the shop type it sold onto the subscription's metadata. */
function shopTypeFromMetadata(metadata: Stripe.Metadata | null): ShopType | null {
  const raw = metadata?.shop_type
  return isShopType(raw) ? raw : null
}

/**
 * What shop type this subscription actually proves, or null when it proves
 * nothing and shop_profiles.shop_type must be left exactly as it is.
 *
 * The full service price book is bought by full service shops and nobody else,
 * so it settles the question on its own. The shared book does not: it rules out
 * full service but cannot tell light duty from heavy duty, because both are the
 * same purchase at the same price id (see the header of lib/shop/billing.ts).
 * Guessing there would silently strip an HD shop of its heavy duty tools on an
 * unrelated Stripe event, so unless metadata names a concrete type we write
 * nothing and leave the shop's own record — the authority — alone.
 */
function resolveShopType(
  priceBook: ShopType | null,
  metadata: Stripe.Metadata | null,
): ShopType | null {
  if (priceBook === 'full_service') return 'full_service'

  const fromMetadata = shopTypeFromMetadata(metadata)

  // No plan price id matched at all (unconfigured env) — metadata is all there is.
  if (priceBook === null) return fromMetadata

  // Shared LD/HD book. Only metadata can say which of the two it is, and
  // metadata claiming full service contradicts what is being paid for, so it
  // loses to the price.
  return fromMetadata === 'ld' || fromMetadata === 'hd' ? fromMetadata : null
}

async function shopIdForSubscription(
  supabase: ServiceClient,
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const fromMetadata = subscription.metadata?.shop_id
  if (typeof fromMetadata === 'string' && fromMetadata.length > 0) return fromMetadata

  const { data } = await supabase
    .from('shop_subscriptions')
    .select('shop_id')
    .eq('stripe_subscription_id', subscription.id)
    .maybeSingle<{ shop_id: string }>()

  return data?.shop_id ?? null
}

/**
 * Writes subscription state for a shop.
 *
 * Never touches `is_charter_member` — that flag is owned solely by
 * claimCharterSlot() and only ever moves false -> true. Writing it here would
 * silently revoke a lifetime price lock on every subsequent Stripe event.
 */
async function upsertSubscription(
  supabase: ServiceClient,
  params: {
    shopId: string
    customerId: string | null
    subscriptionId: string | null
    tier: ShopTier
    /** null when the subscription identifies no type — see resolveShopType. */
    shopType: ShopType | null
    status: SubStatus
    foremanAi: boolean
    currentPeriodEnd: string | null
  },
): Promise<void> {
  await supabase.from('shop_subscriptions').upsert(
    {
      shop_id: params.shopId,
      stripe_customer_id: params.customerId,
      stripe_subscription_id: params.subscriptionId,
      tier: params.tier,
      status: params.status,
      active: isActiveStatus(params.status),
      foreman_ai: params.foremanAi,
      current_period_end: params.currentPeriodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'shop_id' },
  )

  // Keep the shop's denormalized tier — and its type, when the subscription
  // identified one — in step, so the app gates correctly and a shop that
  // upgrades or changes plan keeps its type matching what it actually pays for.
  // shop_type is omitted from the update rather than written as null when
  // nothing was proven: that column is what requireFeature() reads, and blanking
  // it would take a paying shop's diagnostic tools away.
  const profileUpdate: { subscription_tier: ShopTier; shop_type?: ShopType } = {
    subscription_tier: params.tier,
  }
  if (params.shopType) profileUpdate.shop_type = params.shopType

  await supabase.from('shop_profiles').update(profileUpdate).eq('id', params.shopId)
}

async function handleSubscription(
  supabase: ServiceClient,
  subscription: Stripe.Subscription,
  fallbackShopId?: string | null,
): Promise<void> {
  const shopId =
    (await shopIdForSubscription(supabase, subscription)) ?? fallbackShopId ?? null
  if (!shopId) return

  const { tier: tierFromItems, priceBook, foremanAi } = readItems(subscription)
  const tier = tierFromItems ?? tierFromMetadata(subscription.metadata) ?? 'starter'
  const shopType = resolveShopType(priceBook, subscription.metadata)
  const status = toSubStatus(subscription.status)

  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : (subscription.customer?.id ?? null)

  await upsertSubscription(supabase, {
    shopId,
    customerId,
    subscriptionId: subscription.id,
    tier,
    shopType,
    status,
    foremanAi,
    currentPeriodEnd: isoOrNull(subscription.current_period_end),
  })

  // A charter spot is only assigned once the subscription is actually live.
  // claimCharterSlot() is a no-op when the 50 are gone, and never un-sets it.
  // The 50 slots are shared across every shop type — light duty, heavy duty and
  // full service all compete for them. Never add a shop type condition here.
  if (isActiveStatus(status)) {
    await claimCharterSlot(shopId)
  }
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET is not set')
    return new Response('Webhook not configured', { status: 500 })
  }

  const signature = (await headers()).get('stripe-signature')
  if (!signature) return new Response('Missing stripe-signature header', { status: 400 })

  // RAW body — required for signature verification.
  const payload = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'invalid signature'
    console.error('[stripe/webhook] signature verification failed:', message)
    return new Response(`Webhook signature verification failed: ${message}`, {
      status: 400,
    })
  }

  // Past this point we never throw — an unhandled error makes Stripe retry the
  // event forever against a bug that a retry cannot fix.
  try {
    const supabase = createServiceClient()

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        if (session.mode !== 'subscription') break

        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : (session.subscription?.id ?? null)
        if (!subscriptionId) break

        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const fallbackShopId =
          session.metadata?.shop_id ?? session.client_reference_id ?? null

        await handleSubscription(supabase, subscription, fallbackShopId)
        break
      }

      case 'customer.subscription.updated': {
        await handleSubscription(supabase, event.data.object)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        const shopId = await shopIdForSubscription(supabase, subscription)
        if (!shopId) break

        // Deactivate only. The tier, the Stripe ids and — critically — the
        // charter flag stay, so a returning shop keeps its price lock.
        await supabase
          .from('shop_subscriptions')
          .update({
            status: 'canceled',
            active: false,
            foreman_ai: false,
            updated_at: new Date().toISOString(),
          })
          .eq('shop_id', shopId)
        break
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying them.
        break
    }

    return ok()
  } catch (err: unknown) {
    console.error(
      '[stripe/webhook] handler error:',
      err instanceof Error ? err.message : err,
    )
    // 200 on purpose: the signature was valid and the event was received.
    return ok()
  }
}

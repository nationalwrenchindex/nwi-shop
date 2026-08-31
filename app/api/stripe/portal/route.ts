// Stripe billing portal. Managers only — apiContext('manageBilling') enforces
// the same rule the /shop/billing page does.
//
// The portal lets a customer update their card and cancel. It must never be
// configured to offer plan switching that could re-price a charter member; a
// charter subscription's price is locked forever.

import { APP_URL } from '@/lib/branding'
import { apiContext } from '@/lib/auth'
import { stripe } from '@/lib/stripe'

export async function POST() {
  const { ctx, error } = await apiContext('manageBilling')
  if (error) return error

  const customerId = ctx.subscription?.stripe_customer_id
  if (!customerId) {
    return Response.json(
      { error: 'No Stripe customer on file for this shop yet.' },
      { status: 400 },
    )
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}/shop/billing`,
    })
    return Response.json({ url: session.url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not open the billing portal.'
    return Response.json({ error: message }, { status: 502 })
  }
}

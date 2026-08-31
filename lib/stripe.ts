// SERVER-ONLY — do not import from client components.
// This module instantiates the Stripe SDK with the secret key; importing it from
// a client component would pull that key into the browser bundle. Client-safe
// plan metadata lives in lib/shop/billing.ts, which imports nothing from here.

import Stripe from 'stripe'

// Singleton — Next.js re-evaluates modules on every hot reload in dev, and a new
// Stripe client per reload leaks sockets. Cache it on globalThis in dev only.
const globalForStripe = globalThis as unknown as { nwiShopStripe?: Stripe }

export const stripe =
  globalForStripe.nwiShopStripe ??
  new Stripe(process.env.STRIPE_SECRET_KEY ?? '')

if (process.env.NODE_ENV !== 'production') globalForStripe.nwiShopStripe = stripe

/** True when the configured key is a live-mode key. Used to gate destructive tooling. */
export function isLiveMode(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live')
}

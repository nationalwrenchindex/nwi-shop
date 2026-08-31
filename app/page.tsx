// Public marketing landing page for nwishop.com. Renders for signed-out
// visitors — nothing here may call requireShop() or any auth guard.

import type { Metadata } from 'next'
import CharterBanner from '@/app/_components/charter-banner'
import Comparison from '@/app/_components/comparison'
import Features from '@/app/_components/features'
import FinalCta from '@/app/_components/final-cta'
import Hero from '@/app/_components/hero'
import Pricing from '@/app/_components/pricing'
import SiteFooter from '@/app/_components/site-footer'
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/branding'
import { getCharterSlotsRemaining } from '@/lib/shop/charter'

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — The shop management software Fullbay wishes it was`,
  description: PRODUCT_DESCRIPTION,
}

// The charter count is live inventory. force-dynamic keeps it off the build-time
// snapshot, so a visitor never sees a stale number of remaining spots.
export const dynamic = 'force-dynamic'

export default async function LandingPage() {
  // Returns 0 on any failure — the RPC may not even exist yet. At 0 every
  // charter banner, badge and callout below removes itself, so a failed lookup
  // degrades into a plain marketing page rather than a broken or over-promising
  // one. Each section takes the count and decides for itself.
  const slotsRemaining = await getCharterSlotsRemaining()

  return (
    <main className="flex-1">
      <CharterBanner slotsRemaining={slotsRemaining} />
      <Hero slotsRemaining={slotsRemaining} />
      <Features />
      <Comparison slotsRemaining={slotsRemaining} />
      <Pricing slotsRemaining={slotsRemaining} />
      <FinalCta slotsRemaining={slotsRemaining} />
      <SiteFooter slotsRemaining={slotsRemaining} />
    </main>
  )
}

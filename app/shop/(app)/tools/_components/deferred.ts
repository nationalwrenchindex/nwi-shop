// Features that exist in the catalog and gate correctly, but have no page built
// yet. Kept here rather than in catalog.ts so the copy file stays pure copy.
//
// Anything listed here renders as "coming soon" on /shop/tools and is never
// linked, at any tier — the point is that an entitled shop cannot be dropped
// into a 404 by a card for a route that does not exist. Delete an entry the day
// its page ships.
//
// The list is empty right now: fleet_pro was the last entry and came off when
// /shop/tools/fleet-pro shipped. Keep the list (and this file) — it is the
// mechanism, not a one-off, and the next deferred tool goes straight in here.

import type { ShopFeature } from '@/lib/permissions'

export const DEFERRED_FEATURES: ShopFeature[] = []

export function isDeferred(feature: ShopFeature): boolean {
  return DEFERRED_FEATURES.includes(feature)
}

// Features that exist in the catalog and gate correctly, but have no page built
// yet. Kept here rather than in catalog.ts so the copy file stays pure copy.
//
// fleet_pro is DELIBERATELY deferred this round. It is a real, elite-tier
// feature — availableFeatures() returns it to an Elite shop and hasFeature()
// says yes — but /shop/tools/fleet-pro does not exist, so linking it would drop
// an Elite shop into a 404. Anything listed here renders as "coming soon" and is
// never linked, at any tier. Delete the entry the day the page ships.

import type { ShopFeature } from '@/lib/permissions'

export const DEFERRED_FEATURES: ShopFeature[] = ['fleet_pro']

export function isDeferred(feature: ShopFeature): boolean {
  return DEFERRED_FEATURES.includes(feature)
}

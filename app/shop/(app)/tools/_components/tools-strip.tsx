// Compact "Your tools" row for the dashboard. Shows what this shop can open
// right now, then one line on what the next tier up would add.
//
// It computes from shopType + tier rather than taking ctx.features so the
// "next tier" count comes from the same function as the current one — the two
// numbers can never drift. No prices here: the dashboard is not a checkout, and
// Billing owns that conversation.

import Link from 'next/link'
import {
  FEATURE_LABELS,
  FEATURE_SLUGS,
  TIER_LABELS,
  availableFeatures,
} from '@/lib/permissions'
import type { ShopTier, ShopType } from '@/lib/types'
import { isDeferred } from './deferred'

/** null means there is nothing above this tier to sell. */
const NEXT_TIER: Record<ShopTier, ShopTier | null> = {
  starter: 'pro',
  pro:     'elite',
  elite:   null,
}

export default function ToolsStrip({
  shopType,
  tier,
}: {
  shopType: ShopType
  tier: ShopTier
}) {
  // Deferred tools are entitled but have no page, so they are neither linked
  // here nor counted as something an upgrade would hand over.
  const open = availableFeatures(shopType, tier).filter((f) => !isDeferred(f))

  const next = NEXT_TIER[tier]
  const wouldAdd = next
    ? availableFeatures(shopType, next).filter((f) => !isDeferred(f)).length - open.length
    : 0

  return (
    <section className="nwi-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Your tools
        </h2>
        <Link
          href="/shop/tools"
          className="text-sm font-semibold text-slate-700 hover:text-slate-900"
        >
          All tools &rarr;
        </Link>
      </div>

      {open.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          Your plan does not include any tools yet.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {open.map((feature) => (
            <li key={feature}>
              <Link
                href={`/shop/tools/${FEATURE_SLUGS[feature]}`}
                className="inline-flex min-h-[2.25rem] items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
              >
                {FEATURE_LABELS[feature]}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {next && wouldAdd > 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          {TIER_LABELS[next]} unlocks {wouldAdd} more{' '}
          {wouldAdd === 1 ? 'tool' : 'tools'} for your shop.{' '}
          <Link href="/shop/tools" className="font-semibold text-slate-700 hover:text-slate-900">
            See what
          </Link>
          .
        </p>
      ) : null}
    </section>
  )
}

// One tool, in one of three states. Shared by the tools index so every card is
// the same size and shape whether or not the shop can open it — a locked tool
// sitting beside an unlocked one at the same weight is what makes the catalog
// read as a menu instead of a wall of failures.
//
// The card never decides anything: featureBlock() decides, the index groups, and
// this renders what it is handed.

import Link from 'next/link'
import {
  FEATURE_LABELS,
  FEATURE_MIN_TIER,
  FEATURE_SLUGS,
  TIER_LABELS,
  type ShopFeature,
} from '@/lib/permissions'
import type { ShopTier } from '@/lib/types'
import { TOOL_COPY } from './catalog'
import LockedBadge from './locked-badge'

export type ToolCardProps =
  /** Both gates passed and the page exists — the card is a link. */
  | { feature: ShopFeature; state: 'available' }
  /** Right shop type, tier too low. Says which plan unlocks it. */
  | {
      feature: ShopFeature
      state: 'locked'
      /** Techs and foremen cannot open /shop/billing, so they get no link there. */
      canManageBilling: boolean
    }
  /** In the catalog, gates fine, page not built. Never linked. */
  | {
      feature: ShopFeature
      state: 'coming_soon'
      /** Set only when the shop's tier does not already include it. */
      includedWith?: ShopTier
    }

// Shared so the three states line up in a grid regardless of description length.
const SHELL = 'nwi-card flex h-full flex-col p-5'

function Title({ feature }: { feature: ShopFeature }) {
  return (
    <h3 className="text-base font-semibold text-slate-900">
      {FEATURE_LABELS[feature]}
    </h3>
  )
}

function Description({ feature }: { feature: ShopFeature }) {
  return (
    <p className="mt-1 text-sm leading-relaxed text-slate-600">
      {TOOL_COPY[feature].description}
    </p>
  )
}

export default function ToolCard(props: ToolCardProps) {
  const { feature } = props

  if (props.state === 'available') {
    return (
      <Link
        href={`/shop/tools/${FEATURE_SLUGS[feature]}`}
        // Hover is a shadow, not a background or border swap: .nwi-card is a
        // layered component rule and the utilities would fight it inconsistently.
        className={`${SHELL} transition hover:shadow-md`}
      >
        <Title feature={feature} />
        <Description feature={feature} />
        <span className="mt-4 text-sm font-semibold text-slate-700">Open &rarr;</span>
      </Link>
    )
  }

  if (props.state === 'locked') {
    const tier = FEATURE_MIN_TIER[feature]
    return (
      <div className={SHELL}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Title feature={feature} />
          <LockedBadge label={TIER_LABELS[tier]} />
        </div>
        <Description feature={feature} />
        <p className="mt-4 text-sm font-medium text-amber-800">
          {TIER_LABELS[tier]} unlocks {FEATURE_LABELS[feature]}.
        </p>
        {props.canManageBilling ? (
          <Link
            href="/shop/billing"
            className="mt-1 text-sm font-semibold text-slate-700 hover:text-slate-900"
          >
            See plans &rarr;
          </Link>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            Your shop manager can add it from Billing.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={SHELL}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Title feature={feature} />
        <LockedBadge label="Coming soon" tone="soon" />
      </div>
      <Description feature={feature} />
      <p className="mt-4 text-sm text-slate-500">
        {props.includedWith
          ? `Included with ${TIER_LABELS[props.includedWith]}. Not built yet — it will appear here when it ships.`
          : 'Not built yet. It will appear here when it ships, at no extra cost on your current plan.'}
      </p>
    </div>
  )
}

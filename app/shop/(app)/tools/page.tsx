// /shop/tools — the tool catalog. Every role reaches this page: the gates on the
// tools are what the SHOP works on and what the SHOP pays for, not what the
// person may do, so a tech at a heavy-duty shop sees the same list as their
// manager.
//
// Two orthogonal gates, and the page renders them differently on purpose:
//
//   shop type  decides whether a tool is RELEVANT. An LD shop has no use for
//              trailer ABS, so HD tools are never listed as something it is
//              missing — that would be selling a wrench for a truck they do not
//              work on. One neutral line at the bottom names the other type.
//   tier       decides whether a relevant tool is PAID FOR. These ARE listed,
//              in full, with the plan that unlocks them. A shop should be able
//              to see what upgrading buys rather than have the tool silently
//              not exist.
//
// featuresFor(shopType) is the full catalog for this type; featureBlock() sorts
// each entry into a state. Nothing is hardcoded, and each tool page re-checks
// with requireFeature() regardless of what was linked here.

import type { Metadata } from 'next'
import Link from 'next/link'
import PageHeader from '@/components/page-header'
import { requireShop } from '@/lib/auth'
import {
  FEATURE_LABELS,
  FEATURE_MIN_TIER,
  PUBLIC_SHOP_TYPES,
  SHOP_TYPE_DESCRIPTIONS,
  SHOP_TYPE_LABELS,
  TIER_LABELS,
  featureBlock,
  featuresFor,
} from '@/lib/permissions'
import type { ShopFeature } from '@/lib/permissions'
import type { ShopTier } from '@/lib/types'
import ToolCard from './_components/tool-card'
import { isDeferred } from './_components/deferred'

export const metadata: Metadata = { title: 'Tools' }

// Cheapest plan first, so the locked list reads as a ladder rather than a
// jumble: everything Pro adds, then everything Elite adds.
const TIER_ORDER: ShopTier[] = ['starter', 'pro', 'elite']

function byTier(a: ShopFeature, b: ShopFeature): number {
  return (
    TIER_ORDER.indexOf(FEATURE_MIN_TIER[a]) - TIER_ORDER.indexOf(FEATURE_MIN_TIER[b])
  )
}

export default async function ToolsPage() {
  const { shopType, tier, permissions } = await requireShop()

  const catalog = featuresFor(shopType)

  const open:   ShopFeature[] = []
  const locked: ShopFeature[] = []
  const soon:   ShopFeature[] = []

  for (const feature of catalog) {
    // Deferred tools are pulled out ahead of the gates: whether or not the shop
    // is entitled, there is no page to link, so the honest state is "coming
    // soon" and never "upgrade to get this". See _components/deferred.ts.
    if (isDeferred(feature)) {
      soon.push(feature)
      continue
    }
    // Over this shop's own catalog featureBlock() can only answer 'available' or
    // 'tier_too_low' — 'wrong_shop_type' is impossible here by construction, and
    // is handled by the diff against the other shop type below.
    if (featureBlock(shopType, tier, feature) === 'tier_too_low') locked.push(feature)
    else open.push(feature)
  }

  locked.sort(byTier)

  // What a DIFFERENT shop type covers. Built by diffing the other type's catalog
  // against this one and keeping only what this shop's type rules out, so it can
  // never leak a tool the shop is merely under-tiered for.
  //
  // Drawn from PUBLIC_SHOP_TYPES, which is ['ld', 'hd']: Full Service is an
  // unlisted plan and must not be advertised anywhere, signed in or out. The one
  // place its name can appear is the header below, and only for a shop that
  // already IS full service — describing what someone bought is not selling it,
  // and such a shop's catalog is a superset so this section stays empty for them.
  const otherTypes = PUBLIC_SHOP_TYPES.filter((type) => type !== shopType)
    .map((type) => ({
      type,
      adds: featuresFor(type).filter(
        (feature) => featureBlock(shopType, tier, feature) === 'wrong_shop_type',
      ),
    }))
    .filter((entry) => entry.adds.length > 0)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Tools"
        subtitle={`${SHOP_TYPE_LABELS[shopType]} · ${TIER_LABELS[tier]}`}
      />

      <p className="-mt-4 max-w-3xl text-sm leading-relaxed text-slate-600">
        {SHOP_TYPE_DESCRIPTIONS[shopType]}
      </p>

      {open.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Included with your plan
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {open.map((feature) => (
              <ToolCard key={feature} feature={feature} state="available" />
            ))}
          </div>
        </section>
      ) : null}

      {locked.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Add with a higher plan
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            These are built for a {SHOP_TYPE_LABELS[shopType].toLowerCase()} shop
            like yours and turn on the moment the plan covers them. Nothing else
            about your account changes.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {locked.map((feature) => (
              <ToolCard
                key={feature}
                feature={feature}
                state="locked"
                canManageBilling={permissions.manageBilling}
              />
            ))}
          </div>
        </section>
      ) : null}

      {soon.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Coming soon
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {soon.map((feature) => (
              <ToolCard
                key={feature}
                feature={feature}
                state="coming_soon"
                includedWith={
                  featureBlock(shopType, tier, feature) === 'tier_too_low'
                    ? FEATURE_MIN_TIER[feature]
                    : undefined
                }
              />
            ))}
          </div>
        </section>
      ) : null}

      {otherTypes.length > 0 ? (
        <section className="nwi-card p-5 sm:p-6">
          <h2 className="text-base font-semibold text-slate-900">
            Work on the other side of the fence?
          </h2>
          {otherTypes.map((entry) => (
            <p key={entry.type} className="mt-2 text-sm leading-relaxed text-slate-600">
              {SHOP_TYPE_LABELS[entry.type]} shops also get{' '}
              {entry.adds.map((feature) => FEATURE_LABELS[feature]).join(', ')}.
            </p>
          ))}
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            If that is work you take in, talk to us about your shop type — your
            jobs, techs and inventory come with you.
          </p>
          {permissions.manageBilling ? (
            <Link
              href="/shop/billing"
              className="mt-3 inline-block text-sm font-semibold text-slate-700 hover:text-slate-900"
            >
              Billing &rarr;
            </Link>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

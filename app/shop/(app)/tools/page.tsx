// /shop/tools — the Diagnostics index. Every role reaches this page: the gate on
// the tools is what the SHOP bought, not what the person may do, so a tech at a
// heavy-duty shop gets the same list as their manager.
//
// The list is built from ctx.features, which comes from the shop's type via
// featuresFor(). It is never hardcoded — a shop only ever sees links to tools
// its type actually unlocks, and each linked page re-checks with requireFeature().

import type { Metadata } from 'next'
import Link from 'next/link'
import PageHeader from '@/components/page-header'
import { requireShop } from '@/lib/auth'
import {
  FEATURE_LABELS,
  FEATURE_SLUGS,
  PUBLIC_SHOP_TYPES,
  SHOP_TYPE_DESCRIPTIONS,
  SHOP_TYPE_LABELS,
  featuresFor,
} from '@/lib/permissions'
import { TOOL_COPY } from './_components/catalog'

export const metadata: Metadata = { title: 'Diagnostics' }

export default async function ToolsPage() {
  const { shopType, features } = await requireShop()

  // What a different shop type would add on top of what this shop already has.
  // Drawn from PUBLIC_SHOP_TYPES so the unlisted Full Service plan is never
  // advertised here, and no price is quoted either way.
  const otherTypes = PUBLIC_SHOP_TYPES
    .filter((type) => type !== shopType)
    .map((type) => ({
      type,
      adds: featuresFor(type).filter((feature) => !features.includes(feature)),
    }))
    .filter((entry) => entry.adds.length > 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diagnostics"
        subtitle={`${SHOP_TYPE_LABELS[shopType]} shop — ${SHOP_TYPE_DESCRIPTIONS[shopType]}`}
      />

      <section className="grid gap-4 sm:grid-cols-2">
        {features.map((feature) => (
          <Link
            key={feature}
            href={`/shop/tools/${FEATURE_SLUGS[feature]}`}
            // Hover is a shadow rather than a background or border change:
            // .nwi-card is unlayered CSS and would override either of those.
            className="nwi-card block p-5 transition hover:shadow-md"
          >
            <h2 className="text-base font-semibold text-slate-900">
              {FEATURE_LABELS[feature]}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {TOOL_COPY[feature].description}
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-amber-700">
              Not yet available
            </p>
          </Link>
        ))}
      </section>

      <section className="nwi-card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">
          About these tools
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          These are the diagnostic tools your {SHOP_TYPE_LABELS[shopType]} shop
          type unlocks. They run today in the National Wrench Index platform and
          are being brought into NWI Shop — each one opens to a page explaining
          where it stands. Nothing listed here is live yet, so none of it should
          be used on a vehicle.
        </p>

        {otherTypes.length > 0 ? (
          <div className="mt-4 border-t border-slate-200 pt-4">
            {otherTypes.map((entry) => (
              <p key={entry.type} className="text-sm leading-relaxed text-slate-600">
                {SHOP_TYPE_LABELS[entry.type]} shops also get{' '}
                {entry.adds.map((feature) => FEATURE_LABELS[feature]).join(', ')}.
              </p>
            ))}
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              If your shop works on both sides of the fence, talk to us about
              changing your shop type — your jobs, techs and inventory come with
              you.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  )
}

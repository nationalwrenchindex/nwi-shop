// Shared body for every diagnostic tool page. The six tools themselves live in
// the National Wrench Index platform and have not been brought into NWI Shop
// yet, so each route renders this honest placeholder instead.
//
// =====================================================================
// DO NOT PUT SAMPLE DIAGNOSTIC OUTPUT IN THIS COMPONENT.
// No example fault codes, no mocked alarm tables, no placeholder test
// results. A tech reading this page is standing at a truck, and anything
// that looks like a real answer here can put them on the wrong repair.
// "Not available yet" is the correct and complete content.
// =====================================================================

import Link from 'next/link'
import PageHeader from '@/components/page-header'
import { FEATURE_LABELS, type ShopFeature } from '@/lib/permissions'
import { TOOL_COPY } from './catalog'

export default function ToolPlaceholder({ feature }: { feature: ShopFeature }) {
  const label = FEATURE_LABELS[feature]
  const { description, planned } = TOOL_COPY[feature]

  return (
    <div className="space-y-6">
      <PageHeader title={label} subtitle={description} />

      {/* Deliberately NOT .nwi-card: that rule is unlayered CSS in globals.css,
          so its white background and slate border win over Tailwind's layered
          color utilities. A card that needs its own color spells it out. */}
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
        <h2 className="text-base font-semibold text-amber-900">
          Not yet available in NWI Shop
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
          {label} is not built into NWI Shop yet. It runs today in the National
          Wrench Index platform and is being brought over to your shop account as
          its own release. There is no live data on this page — nothing here is
          usable on a vehicle.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
          Your shop type already includes this tool, so it will appear here the
          moment it ships. No plan change is needed.
        </p>
      </section>

      <section className="nwi-card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">What it will do</h2>
        <ul className="mt-3 space-y-2">
          {planned.map((item) => (
            <li key={item} className="flex gap-2 text-sm text-slate-600">
              <span
                aria-hidden
                className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <div>
        <Link href="/shop/tools" className="nwi-btn nwi-btn-secondary">
          Back to Tools
        </Link>
      </div>
    </div>
  )
}

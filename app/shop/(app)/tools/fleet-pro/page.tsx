// /shop/tools/fleet-pro — an outbound referral to NWI Fleet Pro. NOT an integration.
//
// =====================================================================
// READ THIS BEFORE CHANGING THE COPY ON THIS PAGE.
// NWI Fleet Pro is a SEPARATE product with its own site, its own accounts
// and its own signup. There is no Fleet Pro code in this repository: no API
// client, no credentials, no sync job, no unit table, no PM-alert engine.
// Nothing about a job, invoice, customer or vehicle in this shop account is
// sent to Fleet Pro, and nothing is read back.
//
// So every sentence here describes what Fleet Pro does OVER THERE, for the
// fleet customer, and the page ends by sending the reader to the Fleet Pro
// site to set it up. Do not add a status badge, a "connected" indicator, a
// unit count, a sync button, or any sample fleet data — there is no source
// for any of it, and a shop owner who believes their work orders are already
// landing in a customer's fleet record will stop filing them somewhere real.
// If an integration ever gets built, this page gets rewritten then.
// =====================================================================
//
// Gating: requireFeature('fleet_pro') is the FIRST statement, matching every
// other tool page. fleet_pro is elite-tier and type-independent, so Elite shops
// of any shop type land here and starter/pro shops are redirected to /shop.
// That is deliberately consistent with /shop/tools, which buckets fleet_pro by
// featureBlock(): 'available' for Elite (card is a link to here) and
// 'tier_too_low' for starter/pro (card renders locked and is NOT a link). A
// shop therefore never sees a card it cannot open, and no tier reaches a 404.

import type { Metadata } from 'next'
import Link from 'next/link'
import PageHeader from '@/components/page-header'
import { requireFeature } from '@/lib/auth'
import { FEATURE_LABELS } from '@/lib/permissions'

export const metadata: Metadata = { title: FEATURE_LABELS.fleet_pro }

const LEARN_MORE_URL = 'https://info.nwifleetpro.com'
const SET_UP_URL = 'https://nwifleetpro.com'

// The three things a fleet manager actually buys Fleet Pro for. Written as what
// Fleet Pro does inside Fleet Pro — never as something that happens because a
// job was closed in NWI Shop.
const BENEFITS: { title: string; body: string }[] = [
  {
    title: 'Live unit visibility',
    body:
      'Your fleet customer signs in to Fleet Pro and sees every unit they own in one list — which are running, which are down, and which are sitting at a shop. They stop calling your front counter to ask where truck 412 is.',
  },
  {
    title: 'Automatic service records',
    body:
      'Work entered in Fleet Pro is filed against the unit instead of a folder, so a truck carries its own history through driver changes, yard moves and resale. Nobody has to remember which repair order covered which axle.',
  },
  {
    title: 'PM alerts',
    body:
      'Fleet Pro tracks each unit\u2019s PM schedule by miles, hours or date and tells the fleet what is coming due before it is overdue — rather than after a roadside inspection finds it.',
  },
]

export default async function FleetProPage() {
  await requireFeature('fleet_pro')

  return (
    <div className="space-y-6">
      <PageHeader
        title={FEATURE_LABELS.fleet_pro}
        subtitle="Fleet management software for the fleets your shop already services — run by NWI Fleet Pro, set up on their site."
      />

      {/* Deliberately NOT .nwi-card: that rule is unlayered CSS in globals.css,
          so its white background and slate border beat Tailwind's layered color
          utilities. A card that needs its own color spells the colors out. */}
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
        <h2 className="text-base font-semibold text-amber-900">
          Fleet Pro is a separate product — nothing here is connected to it
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
          NWI Fleet Pro runs on its own site, under its own account. NWI Shop
          does not talk to it. No job, invoice, customer or vehicle from this
          shop account is sent to Fleet Pro, and nothing from Fleet Pro is read
          back into your shop. There is no data on this page because there is no
          connection behind it.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
          This page exists to tell you what Fleet Pro is and hand you the door.
          Accounts, units and setup all happen over on the Fleet Pro site, with
          the fleet customer in the room.
        </p>
      </section>

      <section className="nwi-card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">
          What it is, and who it is for
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Fleet Pro is software for the people who own the trucks — the fleet
          customers whose units come through your bays. It gives them one place
          to see their equipment, its service history and what is due next,
          instead of a spreadsheet and a drawer of repair orders.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          For your shop the pitch is simpler: a fleet that can see its own PM
          schedule books the PM. Fleet Pro is their tool, not another screen for
          your techs to keep up with, and it is worth mentioning to the fleet
          accounts you already service.
        </p>
      </section>

      <section className="nwi-card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">
          What a fleet customer gets in Fleet Pro
        </h2>
        <ul className="mt-4 space-y-4">
          {BENEFITS.map((benefit) => (
            <li key={benefit.title}>
              <h3 className="text-sm font-semibold text-slate-900">
                {benefit.title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                {benefit.body}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="nwi-card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">Next step</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Both links below leave NWI Shop and open the NWI Fleet Pro site in a
          new tab. Signing up there does not change anything about this shop
          account, and your NWI Shop login does not carry over.
        </p>
        {/* Plain anchors, not next/link: these are off-site URLs, so there is no
            client-side route to prefetch or intercept. */}
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={SET_UP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="nwi-btn nwi-btn-primary"
          >
            Set Up Fleet Pro for Your Fleet Customers
          </a>
          <a
            href={LEARN_MORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="nwi-btn nwi-btn-secondary"
          >
            Learn More About Fleet Pro
          </a>
        </div>
      </section>

      <div>
        <Link href="/shop/tools" className="nwi-btn nwi-btn-secondary">
          Back to Tools
        </Link>
      </div>
    </div>
  )
}

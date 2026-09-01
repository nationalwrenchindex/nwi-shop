// /shop/tools/garage-sync — file finished repairs into the customer's NWI Garage.
//
// requireFeature() is the FIRST statement. The permission check follows: this
// exposes customer email addresses and writes into a customer's own account, so
// it is scoped to whoever manages customers.

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/page-header'
import { requireFeature } from '@/lib/auth'
import { FEATURE_LABELS } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { loadGarageJobs } from '@/lib/shop/garage'
import GarageTable from './_components/garage-table'

export const metadata: Metadata = { title: FEATURE_LABELS.garage_sync }

export default async function GarageSyncPage() {
  const ctx = await requireFeature('garage_sync')
  if (!ctx.permissions.manageCustomers) redirect('/shop/tools')

  const supabase = await createClient()
  const { rows, guardMissing } = await loadGarageJobs(supabase, ctx.shop.id)

  return (
    <div className="space-y-6">
      <PageHeader
        title={FEATURE_LABELS.garage_sync}
        subtitle="Send a finished repair into the customer's own NWI Garage service history."
      />

      {/* NWI Garage is somebody else's product. Saying that out loud on the page
          is deliberate: it explains why a post can fail for reasons this app
          cannot fix, and why "not posted" is a normal, common outcome. */}
      <section className="nwi-card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">What this does</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          NWI Garage is the free service-history app your customers use. When one
          of them already has an account, posting an invoiced job files the repair
          in their own vehicle history — the mileage, the work, your shop name and
          number. They do nothing.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          This is one way and outbound only. Nothing is ever read back out of a
          customer garage into your shop, and a customer with no NWI Garage
          account is never created one automatically — you get a join link to send
          them instead, with their vehicle already filled in.
        </p>
        <ul className="mt-3 space-y-2 text-sm text-slate-600">
          <li>
            <strong>An email address is required</strong> — it is how a customer is
            matched to their Garage account.
          </li>
          <li>
            <strong>An odometer reading is required</strong> — NWI Garage will not
            accept a service record without one, and their maintenance reminders
            are calculated from it.
          </li>
          <li>
            <strong>Each job posts once.</strong> A job already filed cannot be
            posted again.
          </li>
        </ul>
      </section>

      {guardMissing ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-base font-semibold text-amber-900">
            Posting is unavailable on this database
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
            NWI Shop tracks which jobs have been filed using a column that is not
            present here yet. Without it a job could be filed into a customer
            garage twice with no way to tell, so posting is turned off until the
            migration is applied. You can still copy join links.
          </p>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Invoiced jobs</h2>
        <GarageTable
          rows={rows}
          postingBlocked={
            guardMissing
              ? 'NWI Garage posting is unavailable until the tracking columns exist.'
              : null
          }
        />
      </section>
    </div>
  )
}

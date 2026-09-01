// /shop/tools/torquewrench — automated Google review requests.
//
// requireFeature() is the FIRST statement, so a shop without the entitlement is
// redirected before any query runs. The permission check is separate and comes
// second: a tech at an entitled shop still has no business reading every
// customer's phone number or repointing the shop's review link.

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/page-header'
import { requireFeature } from '@/lib/auth'
import { FEATURE_LABELS } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { absoluteUrl } from '@/lib/branding'
import { loadReviewRequests, loadReviewSettings } from '@/lib/shop/torquewrench/data'
import RequestsTable from './_components/requests-table'
import SettingsForm from './_components/settings-form'

export const metadata: Metadata = { title: FEATURE_LABELS.torquewrench }

/** A stand-in token, so the preview link is the right shape without being real. */
const SAMPLE_LINK = absoluteUrl('/r/Xk7pQ2v9')

export default async function TorqueWrenchPage() {
  const ctx = await requireFeature('torquewrench')
  if (!ctx.permissions.manageCustomers) redirect('/shop/tools')

  const supabase = await createClient()
  const [{ settings, tablesMissing }, { rows, tablesMissing: requestsMissing }] =
    await Promise.all([
      loadReviewSettings(supabase, ctx.shop.id),
      loadReviewRequests(supabase, ctx.shop.id),
    ])

  const schemaMissing = tablesMissing || requestsMissing

  return (
    <div className="space-y-6">
      <PageHeader
        title={FEATURE_LABELS.torquewrench}
        subtitle="Text every customer a Google review link once their job is done."
      />

      {schemaMissing ? (
        // Say it plainly. A form that silently refuses to save is worse than one
        // that explains why it cannot.
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-base font-semibold text-amber-900">
            Not set up on this database yet
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
            The review request tables are not present, so nothing can be saved or
            sent from this page yet. Everything below is read-only until the
            migration is applied.
          </p>
        </section>
      ) : null}

      <section className="nwi-card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">How this works</h2>
        <ol className="mt-3 space-y-2 text-sm text-slate-600">
          <li>1. A job is marked <strong>complete</strong> on the job board.</li>
          <li>
            2. A request is queued for that job — once only, no matter how many
            times the job is reopened or re-saved.
          </li>
          <li>
            3. After your delay elapses, one text goes out with a tracked link.
            Customers who have asked not to be texted are skipped.
          </li>
          <li>
            4. The link records the click, then sends them straight to your Google
            review page.
          </li>
        </ol>
      </section>

      <SettingsForm
        initialSettings={settings}
        businessName={ctx.shop.business_name}
        sampleLink={SAMPLE_LINK}
        disabledReason={
          schemaMissing
            ? 'Saving is unavailable until the review request tables exist.'
            : null
        }
      />

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Recent requests</h2>
        <RequestsTable rows={rows} />
      </section>
    </div>
  )
}

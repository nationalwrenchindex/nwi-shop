import type { Metadata } from 'next'
import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { TIER_LABELS } from '@/lib/permissions'
import { FOREMAN_AI_ADDON, SHOP_PLANS, canBuyForemanAi } from '@/lib/shop/billing'
import { CHARTER_LIMIT } from '@/lib/shop/charter'
import type { SubStatus } from '@/lib/types'
import PortalButton from './_components/portal-button'

export const metadata: Metadata = { title: 'Billing' }

// The subscription state must reflect what Stripe just wrote via the webhook,
// so this page is never cached.
export const dynamic = 'force-dynamic'

const STATUS_COPY: Record<SubStatus, { label: string; tone: string }> = {
  active:     { label: 'Active',              tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  trialing:   { label: 'Trial',               tone: 'bg-sky-50 text-sky-800 ring-sky-200' },
  past_due:   { label: 'Past due',            tone: 'bg-amber-50 text-amber-900 ring-amber-200' },
  incomplete: { label: 'Awaiting payment',    tone: 'bg-slate-100 text-slate-700 ring-slate-300' },
  canceled:   { label: 'Canceled',            tone: 'bg-red-50 text-red-800 ring-red-200' },
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 py-3 last:border-0">
      <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="text-sm font-medium text-slate-900">{children}</dd>
    </div>
  )
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  // Manager-only. requirePermission redirects a foreman or tech to /shop.
  const ctx = await requirePermission('manageBilling')
  const { checkout } = await searchParams

  const sub = ctx.subscription
  const tier = sub?.tier ?? ctx.shop.subscription_tier
  const plan = SHOP_PLANS[tier]
  const status: SubStatus = sub?.status ?? 'incomplete'
  const statusCopy = STATUS_COPY[status]
  const charter = sub?.is_charter_member === true

  // Foreman AI is a separate $59/mo product. `canBuyForemanAi` only says the
  // tier is eligible to purchase it — it is never included in a plan price.
  const eligibleForForemanAi = canBuyForemanAi(tier)
  const hasForemanAi = sub?.foreman_ai === true

  const monthlyTotal = plan.price + (hasForemanAi ? FOREMAN_AI_ADDON.price : 0)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Billing</h1>
        <p className="mt-1 text-sm text-slate-600">
          Subscription and payment settings for {ctx.shop.business_name}.
        </p>
      </header>

      {checkout === 'success' ? (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">You&apos;re all set.</p>
          <p className="mt-1 text-sm text-emerald-800">
            Payment received. If the details below still look pending, give Stripe a
            few seconds and refresh — we finalize the subscription when their
            confirmation lands.
          </p>
        </div>
      ) : null}

      {charter ? (
        <div className="mb-6 overflow-hidden rounded-xl border border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50">
          <div className="flex flex-wrap items-center gap-3 p-4">
            <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
              Charter Member
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-800 ring-1 ring-amber-300">
              Price locked forever
            </span>
            <p className="w-full text-sm text-amber-900 sm:w-auto sm:flex-1">
              You are one of the first {CHARTER_LIMIT} shops on NWI Shop. Your rate of
              ${plan.price}/mo never increases — not at renewal, not ever.
            </p>
          </div>
        </div>
      ) : null}

      <section className="nwi-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{TIER_LABELS[tier]}</h2>
            <p className="mt-0.5 text-sm text-slate-600">{plan.tagline}</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${statusCopy.tone}`}
          >
            {statusCopy.label}
          </span>
        </div>

        <dl className="mt-5">
          <Row label="Plan">
            ${plan.price}
            <span className="font-normal text-slate-500">/mo</span>
          </Row>
          <Row label="Foreman AI add-on">
            {hasForemanAi ? (
              <>
                ${FOREMAN_AI_ADDON.price}
                <span className="font-normal text-slate-500">/mo — active</span>
              </>
            ) : (
              <span className="font-normal text-slate-500">
                {eligibleForForemanAi ? 'Not added' : 'Requires Elite'}
              </span>
            )}
          </Row>
          <Row label={status === 'canceled' ? 'Access ends' : 'Renews'}>
            {formatDate(sub?.current_period_end ?? null)}
          </Row>
          <Row label="Charter member">
            {charter ? (
              <span className="font-semibold text-amber-700">
                Yes — price locked forever
              </span>
            ) : (
              <span className="font-normal text-slate-500">No</span>
            )}
          </Row>
          <Row label="Monthly total">
            <span className="text-base font-semibold">${monthlyTotal}</span>
            <span className="font-normal text-slate-500">/mo</span>
          </Row>
        </dl>

        <div className="mt-6 border-t border-slate-100 pt-5">
          <PortalButton disabled={!sub?.stripe_customer_id} />
          <p className="mt-3 text-xs text-slate-500">
            Update your card, download invoices, or cancel. No contracts — cancel
            anytime.
          </p>
        </div>
      </section>

      {/* Foreman AI is presented as its own product, never as a plan feature. */}
      <section className="nwi-card mt-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            {FOREMAN_AI_ADDON.label}
          </h2>
          <p className="text-sm font-semibold text-slate-900">
            ${FOREMAN_AI_ADDON.price}
            <span className="font-normal text-slate-500">/mo — separate add-on</span>
          </p>
        </div>
        <p className="mt-2 text-sm text-slate-600">{FOREMAN_AI_ADDON.description}</p>
        <p className="mt-3 text-sm text-slate-600">
          {hasForemanAi
            ? 'Foreman AI is on your subscription as its own line item.'
            : eligibleForForemanAi
              ? 'Add or remove Foreman AI from the Stripe portal above — it bills separately from your plan.'
              : `Foreman AI is available on ${TIER_LABELS.elite}. It is never bundled into a plan price.`}
        </p>
      </section>

      {!sub ? (
        <p className="mt-6 text-sm text-slate-600">
          No subscription on file yet.{' '}
          <Link className="font-semibold text-slate-900 underline" href="/shop/signup">
            Choose a plan
          </Link>{' '}
          to activate your shop.
        </p>
      ) : null}
    </div>
  )
}

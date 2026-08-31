'use client'

import { useState } from 'react'
import {
  FEATURE_LABELS,
  FEATURES_BY_TYPE,
  SHOP_TYPE_DESCRIPTIONS,
  SHOP_TYPE_LABELS,
} from '@/lib/permissions'
import {
  FOREMAN_AI_ADDON,
  canBuyForemanAi,
  planFor,
  planListFor,
} from '@/lib/shop/billing'
import type { ShopTier, ShopType } from '@/lib/types'

interface Props {
  initialTier: ShopTier
  /** Preselected shop type — from `?type=`, else the first offered type. */
  initialShopType: ShopType
  /** The types this visitor may choose. Built by the page, never hardcoded. */
  shopTypes: ShopType[]
  /** True when the visitor arrived on the unlisted `?type=full_service` link. */
  fullServiceUnlocked: boolean
  /** 0 hides every charter callout — see getCharterSlotsRemaining(). */
  charterSlots: number
  canceled: boolean
}

export default function SignupForm({
  initialTier,
  initialShopType,
  shopTypes,
  fullServiceUnlocked,
  charterSlots,
  canceled,
}: Props) {
  const [shopType, setShopType] = useState<ShopType>(initialShopType)
  const [tier, setTier] = useState<ShopTier>(initialTier)
  const [businessName, setBusinessName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [foremanAi, setForemanAi] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Price and plan copy both follow the selected type, so switching type
  // re-prices all three cards from the right price book.
  const planOptions = planListFor(shopType)
  const plan = planFor(shopType, tier)
  const tools = FEATURES_BY_TYPE[shopType]
  // Only Elite may add Foreman AI, and even there it is a separate product —
  // for every shop type, full service included.
  const addonAvailable = canBuyForemanAi(tier)
  const addonSelected = addonAvailable && foremanAi
  const monthlyTotal = plan.price + (addonSelected ? FOREMAN_AI_ADDON.price : 0)

  function selectTier(next: ShopTier) {
    setTier(next)
    if (!canBuyForemanAi(next)) setForemanAi(false)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const res = await fetch('/api/shop/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: tier,
          shop_type: shopType,
          businessName: businessName.trim(),
          ownerName: ownerName.trim(),
          email: email.trim(),
          password,
          phone: phone.trim(),
          foremanAi: addonSelected,
        }),
      })

      const body: { url?: string; error?: string } = await res.json()
      if (!res.ok || !body.url) {
        setError(body.error ?? 'Something went wrong. Please try again.')
        setBusy(false)
        return
      }

      window.location.href = body.url
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      {canceled ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Checkout was canceled — nothing was charged. Pick up where you left off
          whenever you&apos;re ready.
        </p>
      ) : null}

      {/* ---------------- Step 1 — shop type ---------------- */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
          Step 1 — What does your shop work on?
        </h2>

        <div className="mt-4 grid gap-3">
          {shopTypes.map((option) => {
            const selected = option === shopType
            return (
              <button
                key={option}
                type="button"
                onClick={() => setShopType(option)}
                aria-pressed={selected}
                className={`rounded-xl border p-4 text-left transition ${
                  selected
                    ? 'border-slate-900 bg-slate-900 text-white shadow-lg'
                    : 'border-slate-200 bg-white hover:border-slate-400'
                }`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold">
                    {SHOP_TYPE_LABELS[option]}
                  </span>
                  {option === 'full_service' ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                        selected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      By invitation
                    </span>
                  ) : null}
                </span>
                <p
                  className={`mt-1 text-sm ${selected ? 'text-slate-300' : 'text-slate-600'}`}
                >
                  {SHOP_TYPE_DESCRIPTIONS[option]}
                </p>
              </button>
            )
          })}
        </div>

        {fullServiceUnlocked ? (
          <p className="mt-3 text-sm text-slate-500">
            {SHOP_TYPE_LABELS.full_service} is not listed on our public pricing page —
            you have it here because you were sent this link.
          </p>
        ) : null}

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
            Diagnostic tools included
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {tools.map((feature) => (
              <li
                key={feature}
                className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800"
              >
                {FEATURE_LABELS[feature]}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------- Step 2 — plan ---------------- */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
          Step 2 — Choose your plan
        </h2>

        <div className="mt-4 grid gap-3">
          {planOptions.map((option) => {
            const selected = option.tier === tier
            return (
              <button
                key={option.tier}
                type="button"
                onClick={() => selectTier(option.tier)}
                aria-pressed={selected}
                className={`rounded-xl border p-4 text-left transition ${
                  selected
                    ? 'border-slate-900 bg-slate-900 text-white shadow-lg'
                    : 'border-slate-200 bg-white hover:border-slate-400'
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-base font-semibold">{option.label}</span>
                  <span className="text-lg font-bold">
                    ${option.price}
                    <span
                      className={`text-sm font-normal ${selected ? 'text-slate-300' : 'text-slate-500'}`}
                    >
                      /mo
                    </span>
                  </span>
                </div>
                <p
                  className={`mt-1 text-sm ${selected ? 'text-slate-300' : 'text-slate-600'}`}
                >
                  {option.sharedFeatures.slice(0, 3).join(' · ')}
                </p>
              </button>
            )
          })}
        </div>

        {/* Foreman AI is NEVER part of a plan price — it is a separate product. */}
        {addonAvailable ? (
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400">
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-slate-900"
              checked={foremanAi}
              onChange={(e) => setForemanAi(e.target.checked)}
            />
            <span>
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-slate-900">
                  Add {FOREMAN_AI_ADDON.label}
                </span>
                <span className="text-sm font-semibold text-slate-900">
                  +${FOREMAN_AI_ADDON.price}/mo
                </span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  Separate add-on
                </span>
              </span>
              <span className="mt-1 block text-sm text-slate-600">
                {FOREMAN_AI_ADDON.description}
              </span>
            </span>
          </label>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            {FOREMAN_AI_ADDON.label} is a separate ${FOREMAN_AI_ADDON.price}/mo add-on,
            available on {planFor(shopType, 'elite').label}.
          </p>
        )}
      </section>

      {/* ---------------- Step 3 — account ---------------- */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
          Step 3 — Your shop
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="nwi-label" htmlFor="businessName">
              Business name
            </label>
            <input
              id="businessName"
              className="nwi-input"
              required
              autoComplete="organization"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Ridgeline Diesel & Auto"
            />
          </div>

          <div>
            <label className="nwi-label" htmlFor="ownerName">
              Your name
            </label>
            <input
              id="ownerName"
              className="nwi-input"
              required
              autoComplete="name"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Dale Whitcomb"
            />
          </div>

          <div>
            <label className="nwi-label" htmlFor="phone">
              Shop phone
            </label>
            <input
              id="phone"
              className="nwi-input"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(219) 555-0142"
            />
          </div>

          <div>
            <label className="nwi-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="nwi-input"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourshop.com"
            />
          </div>

          <div>
            <label className="nwi-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="nwi-input"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
          </div>
        </div>
      </section>

      {/* ---------------- Step 4 — checkout ---------------- */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm text-slate-600">
            {plan.label} · {SHOP_TYPE_LABELS[shopType]}
          </span>
          <span className="text-sm font-semibold text-slate-900">${plan.price}/mo</span>
        </div>
        {addonSelected ? (
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-slate-600">
              {FOREMAN_AI_ADDON.label} (separate add-on)
            </span>
            <span className="text-sm font-semibold text-slate-900">
              ${FOREMAN_AI_ADDON.price}/mo
            </span>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-100 pt-3">
          <span className="text-sm font-semibold text-slate-900">Due monthly</span>
          <span className="text-xl font-bold text-slate-900">${monthlyTotal}/mo</span>
        </div>

        {charterSlots > 0 ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
            Charter pricing applies — ${monthlyTotal}/mo locked forever, no increases
            ever.
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="nwi-btn nwi-btn-primary mt-4 w-full"
          disabled={busy}
        >
          {busy ? 'Taking you to Stripe…' : `Continue to payment — $${monthlyTotal}/mo`}
        </button>

        <p className="mt-3 text-center text-xs text-slate-500">
          Secure checkout by Stripe. No contracts. Cancel anytime.
        </p>
      </section>
    </form>
  )
}

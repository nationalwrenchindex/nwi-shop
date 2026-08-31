import Link from 'next/link'
import { PUBLIC_SHOP_TYPES, SHOP_TYPE_LABELS } from '@/lib/permissions'
import {
  FOREMAN_AI_ADDON,
  PUBLIC_PLANS,
  PUBLIC_PLAN_LIST,
  toolNamesFor,
} from '@/lib/shop/billing'
import { CHARTER_LIMIT } from '@/lib/shop/charter'

/**
 * Pricing cards. Every number here comes from PUBLIC_PLAN_LIST /
 * FOREMAN_AI_ADDON, which read priceFor() and TIER_LIMITS — the price is never
 * written twice.
 *
 * PUBLIC_PLAN_LIST is the shared light/heavy duty price book, which is the only
 * one quoted publicly: light and heavy duty cost the same, so one set of cards
 * covers both, and the tools each type unlocks are listed under the cards from
 * PUBLIC_SHOP_TYPES.
 *
 * Charter copy appears only when `slotsRemaining > 0`. At 0 the callouts vanish
 * completely rather than degrading into "0 spots left". Charter applies to every
 * shop type — no type condition anywhere.
 */
export default function Pricing({ slotsRemaining }: { slotsRemaining: number }) {
  const charterOpen = slotsRemaining > 0

  return (
    <section id="pricing" className="scroll-mt-8 bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-600">
            Pricing
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
            One price. Every feature. No per-seat games.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-slate-600">
            Pick the plan that fits your bay count and crew size. Everything in the
            product is in every plan — the tiers only change how much shop you can
            run on it.
          </p>
        </div>

        {charterOpen ? (
          <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
            <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-slate-950">
              {slotsRemaining} of {CHARTER_LIMIT} left
            </span>
            <p className="text-sm font-semibold text-amber-950">
              Charter members keep their signup price forever — no increases, ever,
              on any plan below.
            </p>
          </div>
        ) : null}

        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {PUBLIC_PLAN_LIST.map((plan) => {
            const featured = plan.highlight
            return (
              <div
                key={plan.tier}
                className={`relative flex flex-col rounded-2xl border p-7 ${
                  featured
                    ? 'border-slate-950 bg-slate-950 text-white shadow-2xl lg:-my-3 lg:py-10'
                    : 'border-slate-200 bg-white'
                }`}
              >
                {featured ? (
                  <span className="absolute -top-3 left-7 rounded-full bg-amber-500 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-slate-950">
                    Most shops
                  </span>
                ) : null}

                <h3
                  className={`text-lg font-semibold ${featured ? 'text-white' : 'text-slate-950'}`}
                >
                  {plan.label}
                </h3>
                <p
                  className={`mt-1 text-sm ${featured ? 'text-slate-400' : 'text-slate-600'}`}
                >
                  {plan.tagline}
                </p>

                <p className="mt-6 flex items-baseline gap-1">
                  <span
                    className={`text-5xl font-bold tracking-tight ${featured ? 'text-white' : 'text-slate-950'}`}
                  >
                    ${plan.price}
                  </span>
                  <span
                    className={`text-base font-medium ${featured ? 'text-slate-400' : 'text-slate-500'}`}
                  >
                    /mo
                  </span>
                </p>

                {charterOpen ? (
                  <p
                    className={`mt-3 rounded-lg px-3 py-2 text-xs font-bold ${
                      featured
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                    }`}
                  >
                    Charter price — locked at ${plan.price}/mo forever.
                  </p>
                ) : null}

                <ul
                  className={`mt-7 flex-1 space-y-3 text-sm ${featured ? 'text-slate-300' : 'text-slate-700'}`}
                >
                  {plan.sharedFeatures.map((feature) => (
                    <li key={feature} className="flex gap-3">
                      <span
                        aria-hidden
                        className={`mt-px font-bold ${featured ? 'text-amber-400' : 'text-amber-600'}`}
                      >
                        ✓
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>

                {/*
                  Foreman AI is NEVER listed as an included feature — not even on
                  Elite. Elite only makes it purchasable, as a separate line item.
                */}
                {plan.foremanAiAvailable ? (
                  <p
                    className={`mt-5 border-t pt-4 text-xs ${
                      featured
                        ? 'border-white/10 text-slate-400'
                        : 'border-slate-200 text-slate-500'
                    }`}
                  >
                    {FOREMAN_AI_ADDON.label} available as a separate $
                    {FOREMAN_AI_ADDON.price}/mo add-on — not included in this plan.
                  </p>
                ) : null}

                <Link
                  href={`/shop/signup?plan=${plan.tier}`}
                  className={`mt-7 rounded-xl px-5 py-3.5 text-center text-base font-bold transition ${
                    featured
                      ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                      : 'bg-slate-950 text-white hover:bg-slate-800'
                  }`}
                >
                  Get Started
                </Link>
              </div>
            )
          })}
        </div>

        {/*
          Which diagnostic tools come with which kind of shop. Same price either
          way, so this sits under the cards rather than splitting the grid in
          two. Driven by PUBLIC_SHOP_TYPES + toolNamesFor(), so it lists exactly
          the types we sell publicly and nothing else.
        */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {PUBLIC_SHOP_TYPES.map((type) => (
            <div key={type} className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-950">
                  {SHOP_TYPE_LABELS[type]} shops
                </h3>
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-amber-600">
                  Same price
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Diagnostic tools on every plan: {toolNamesFor(type)}.
              </p>
              <p className="mt-3 text-sm text-slate-500">
                Choose {SHOP_TYPE_LABELS[type]} at signup and these unlock for your
                whole crew.
              </p>
            </div>
          ))}
        </div>

        {/* --- Foreman AI: its own product, presented on its own --- */}
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-7">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-2xl">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-lg font-semibold text-slate-950">
                  {FOREMAN_AI_ADDON.label}
                </h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-600">
                  Separate add-on
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {FOREMAN_AI_ADDON.description}
              </p>
              <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700">
                {FOREMAN_AI_ADDON.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden className="font-bold text-amber-600">
                      ✓
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            <div className="text-right">
              <p className="text-4xl font-bold tracking-tight text-slate-950">
                ${FOREMAN_AI_ADDON.price}
                <span className="text-base font-medium text-slate-500">/mo</span>
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Billed separately
              </p>
              <Link
                href={`/shop/signup?plan=${PUBLIC_PLANS.elite.tier}`}
                className="mt-4 inline-block rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-950 hover:border-slate-950"
              >
                Add with Elite
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

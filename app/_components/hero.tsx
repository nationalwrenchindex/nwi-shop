import Link from 'next/link'
import { PRODUCT_NAME } from '@/lib/branding'
import { SHOP_PLANS } from '@/lib/shop/billing'

export default function Hero({ slotsRemaining }: { slotsRemaining: number }) {
  return (
    <section className="relative isolate overflow-hidden bg-slate-950">
      {/* Warm shop-light wash behind the headline. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[36rem] w-[72rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(245,158,11,0.22),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:64px_64px]"
      />

      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="text-sm font-black uppercase tracking-[0.22em] text-white">
          {PRODUCT_NAME}
        </span>
        <div className="flex items-center gap-6">
          <Link
            href="#pricing"
            className="hidden text-sm font-semibold text-slate-300 hover:text-white sm:block"
          >
            Pricing
          </Link>
          <Link
            href="/login"
            className="text-sm font-semibold text-slate-300 hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/shop/signup"
            className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-950 hover:bg-slate-200"
          >
            Start free setup
          </Link>
        </div>
      </nav>

      <div className="mx-auto max-w-6xl px-4 pb-24 pt-14 sm:px-6 sm:pb-32 sm:pt-20">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">
          Shop management software
        </p>

        <h1 className="mt-5 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl">
          The shop management software{' '}
          <span className="bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent">
            Fullbay wishes it was.
          </span>
        </h1>

        <p className="mt-7 max-w-2xl text-lg leading-relaxed text-slate-300 sm:text-xl">
          Bays, techs, parts, hours and invoices on one board — priced so an
          independent shop can actually run it. Built by people who have turned
          wrenches, for the people still turning them.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/shop/signup"
            className="rounded-xl bg-amber-500 px-7 py-4 text-base font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400"
          >
            Start your shop
          </Link>
          <Link
            href="#pricing"
            className="rounded-xl border border-white/20 px-7 py-4 text-base font-semibold text-white transition hover:border-white/50"
          >
            See pricing — from ${SHOP_PLANS.starter.price}/mo
          </Link>
        </div>

        {slotsRemaining > 0 ? (
          <p className="mt-6 text-sm font-semibold text-amber-300">
            {slotsRemaining} charter spots left — lock your price permanently.
          </p>
        ) : null}

        <dl className="mt-16 grid max-w-3xl grid-cols-2 gap-x-8 gap-y-8 border-t border-white/10 pt-10 sm:grid-cols-4">
          {[
            ['Bays', 'Live visual job board'],
            ['Techs', 'Timeclock built in'],
            ['Parts', 'Shop + van inventory'],
            ['Invoices', 'Out the door same day'],
          ].map(([term, detail]) => (
            <div key={term}>
              <dt className="text-sm font-bold uppercase tracking-[0.14em] text-amber-400">
                {term}
              </dt>
              <dd className="mt-1.5 text-sm text-slate-400">{detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

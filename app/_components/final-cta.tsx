import Link from 'next/link'
import { CHARTER_LIMIT } from '@/lib/shop/charter'

export default function FinalCta({ slotsRemaining }: { slotsRemaining: number }) {
  const charterOpen = slotsRemaining > 0

  return (
    <section className="bg-amber-500">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-8 px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            {charterOpen
              ? `Only ${slotsRemaining} of ${CHARTER_LIMIT} charter spots are left.`
              : 'Get your bays on the board this week.'}
          </h2>
          <p className="mt-3 text-lg text-amber-950">
            {charterOpen
              ? 'Claim one and your price never goes up — not at renewal, not when we add features, not ever.'
              : 'Set up your shop, your bays and your crew in an afternoon. No contract, cancel anytime.'}
          </p>
        </div>

        <Link
          href="/shop/signup"
          className="rounded-xl bg-slate-950 px-8 py-4 text-base font-bold text-white shadow-lg transition hover:bg-slate-800"
        >
          {charterOpen ? 'Claim your charter spot' : 'Start your shop'}
        </Link>
      </div>
    </section>
  )
}

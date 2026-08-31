import type { Metadata } from 'next'
import Link from 'next/link'
import { PRODUCT_NAME } from '@/lib/branding'
import { parseTier } from '@/lib/shop/billing'
import { CHARTER_LIMIT, getCharterSlotsRemaining } from '@/lib/shop/charter'
import SignupForm from './_components/signup-form'

export const metadata: Metadata = {
  title: 'Start your shop',
  description: `Create your ${PRODUCT_NAME} account and get your bays, techs and inventory in one place.`,
}

// The charter count has to be read live on every visit, never baked in at build.
export const dynamic = 'force-dynamic'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const planParam = typeof params.plan === 'string' ? params.plan : null
  const initialTier = parseTier(planParam) ?? 'pro'
  const canceled = params.canceled === '1'

  // Returns 0 on any failure, which hides charter messaging rather than
  // promising a price lock we might not be able to honor.
  const charterSlots = await getCharterSlotsRemaining()

  return (
    <div className="flex-1 bg-slate-100">
      {charterSlots > 0 ? (
        <div className="bg-amber-500 px-4 py-2.5 text-center text-sm font-semibold text-slate-950">
          {charterSlots} of {CHARTER_LIMIT} Charter spots remaining — your price is
          locked forever, no increases ever.
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-8">
          <Link
            href="/"
            className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 hover:text-slate-900"
          >
            ← {PRODUCT_NAME}
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Get your shop running.
          </h1>
          <p className="mt-2 text-base text-slate-600">
            Pick a plan, create your account, and you&apos;re on the board in minutes.
            No setup fee, no contract.
          </p>
        </header>

        <SignupForm
          initialTier={initialTier}
          charterSlots={charterSlots}
          canceled={canceled}
        />

        <p className="mt-8 text-center text-sm text-slate-600">
          Already have an account?{' '}
          <Link className="font-semibold text-slate-900 underline" href="/login">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

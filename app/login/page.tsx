import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getShopContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/branding'
import SignOutButton from '@/components/sign-out-button'
import LoginForm from './_components/login-form'

export const metadata: Metadata = {
  title: 'Sign in',
  description: `Sign in to your ${PRODUCT_NAME} shop.`,
}

/** Only same-origin relative paths survive — never bounce to an external host. */
function safeRedirect(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/shop'
  return value
}

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  // Next 16: searchParams is a Promise and must be awaited.
  const params = await searchParams
  const redirectTo = safeRedirect(params.redirect)
  const errorParam = Array.isArray(params.error) ? params.error[0] : params.error

  // Already a member of a shop — go straight in. This lives here rather than in
  // proxy.ts because it needs the shop_techs lookup: a signed-in user with no
  // tech row must NOT be bounced to /shop, or they ping-pong with requireShop().
  const ctx = await getShopContext()
  if (ctx) redirect(redirectTo)

  // Session but no shop membership: deactivated, or a signup that never
  // finished. Say so plainly instead of silently showing a sign-in form they
  // are already past.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const orphaned = Boolean(user)

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="text-2xl font-bold tracking-tight text-white">
            {PRODUCT_NAME}
          </Link>
          <p className="mt-2 text-sm text-slate-400">{PRODUCT_TAGLINE}</p>
        </div>

        <div className="rounded-xl bg-white p-6 shadow-xl sm:p-8">
          <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">
            Use the email your shop manager added you with.
          </p>

          {errorParam ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorParam}
            </p>
          ) : null}

          {orphaned ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">
                You&apos;re signed in as {user?.email}, but this account isn&apos;t
                attached to an active shop.
              </p>
              <p className="mt-1 text-sm text-amber-800">
                Ask your shop manager to add or reactivate you, or sign out and use a
                different account.
              </p>
              <div className="mt-3">
                <SignOutButton className="nwi-btn nwi-btn-secondary" />
              </div>
            </div>
          ) : (
            <LoginForm redirectTo={redirectTo} />
          )}
        </div>

        <p className="mt-6 text-center text-sm text-slate-400">
          New shop?{' '}
          <Link href="/shop/signup" className="font-semibold text-white hover:underline">
            Start a subscription
          </Link>
        </p>
      </div>
    </main>
  )
}

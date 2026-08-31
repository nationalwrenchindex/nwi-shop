// Next.js 16 root proxy (this file replaces the deprecated middleware.ts).
//
// SCOPE — read before adding rules here:
// The proxy runs on every matched request and must stay cheap. It refreshes the
// Supabase session cookie and performs the AUTHENTICATION gate only: is there a
// signed-in user at all. It deliberately does NOT resolve the caller's shop role,
// because that requires a database round-trip (shop_techs -> role) on every asset
// and navigation. ROLE / PERMISSION gating is done per-route instead:
//   - Server Components: requireShop() / requirePermission() / requireRole()
//   - Route Handlers:    apiContext(permission)
// The absence of role checks below is intentional, not a gap.

import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

/**
 * Routes reachable while signed out, matched on whole path segments.
 * `/shop/signup` and `/api/shop/checkout` sit under otherwise-protected prefixes:
 * they are how a shop that does not exist yet creates its first account, so they
 * must stay open.
 */
const PUBLIC_PREFIXES = ['/auth', '/api/stripe', '/shop/signup', '/api/shop/checkout']
const PUBLIC_EXACT = new Set(['/', '/login'])

/** Everything below these prefixes requires a session. */
const PROTECTED_PREFIXES = ['/shop', '/api/shop']

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // Always refresh the session first — the returned response carries the
  // rotated auth cookies and must be the one we hand back.
  const { response, user } = await updateSession(request)

  // Bouncing a signed-in user off /login is deliberately NOT done here. A user
  // can hold a valid session and still have no shop_techs row (deactivated, or a
  // signup that never finished); requireShop() sends them to /login, and a blind
  // proxy-level bounce back to /shop would loop forever. app/login/page.tsx makes
  // that call instead, where it can afford the one query that tells the two apart.

  if (isPublic(pathname)) return response

  if (!user && isProtected(pathname)) {
    // API callers get a JSON 401; they cannot follow an HTML redirect.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const login = new URL('/login', request.url)
    login.searchParams.set('redirect', `${pathname}${search}`)
    return NextResponse.redirect(login)
  }

  return response
}

export const config = {
  matcher: [
    // Everything except Next internals, the favicon, and static asset files.
    '/((?!_next/static|_next/image|favicon[.]ico|.*[.](?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|xml|woff|woff2|ttf|otf)$).*)',
  ],
}

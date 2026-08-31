// OAuth / magic-link landing. Supabase sends the browser here with a `code`
// which we exchange for a session cookie, then forward to the original target.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Only same-origin relative paths may be used as a redirect target. */
function safeNext(raw: string | null): string {
  if (!raw) return '/shop'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/shop'
  return raw
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next') ?? searchParams.get('redirect'))

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('Missing sign-in code. Request a new link.')}`,
    )
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    )
  }

  return NextResponse.redirect(`${origin}${next}`)
}

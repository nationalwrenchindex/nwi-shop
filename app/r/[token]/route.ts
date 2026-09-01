// GET /r/<token> — the link inside every review-request text.
//
// PUBLIC BY DESIGN. The person opening this is a customer on their phone with no
// NWI Shop account, so it lives outside /shop and uses the service client. It is
// not under proxy.ts's protected prefixes, so it is reachable signed out today;
// if /shop or /api/shop ever grows to cover it, this route must be added to
// PUBLIC_PREFIXES or every review link in the wild breaks.
//
// Looked up by `token`, never by row id. The Suite put a sequential-ish id in
// this URL, which let anyone incrementing it stamp clicks on other people's
// requests and confirm which customers had been contacted.
//
// The response is always a redirect. A bad token, a missing table, a shop that
// cleared its place id — all of them send the customer somewhere sensible rather
// than showing them a stack trace, because they did nothing wrong.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { buildGoogleReviewUrl } from '@/lib/shop/torquewrench/review-url'
import { APP_URL } from '@/lib/branding'
import type { ShopReviewRequest, ShopReviewSettings } from '@/lib/shop/torquewrench/types'

export const dynamic = 'force-dynamic'

/** Where a click goes when we cannot resolve a review destination. */
const FALLBACK_URL = APP_URL

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token) return NextResponse.redirect(FALLBACK_URL, { status: 302 })

  const supabase = createServiceClient()

  const { data: review, error } = await supabase
    .from('shop_review_requests')
    .select('id, shop_id, clicked_at')
    .eq('token', token)
    .maybeSingle<Pick<ShopReviewRequest, 'id' | 'shop_id' | 'clicked_at'>>()

  if (error) {
    console.error('[review-click] lookup failed:', error.message)
    return NextResponse.redirect(FALLBACK_URL, { status: 302 })
  }
  if (!review) {
    return NextResponse.redirect(FALLBACK_URL, { status: 302 })
  }

  // First click only. A customer who opens the link, backs out and taps again is
  // one interested customer, and clicked_at is the timestamp the shop reads as
  // "when they engaged" — overwriting it would move that later every time.
  if (!review.clicked_at) {
    const { error: stampError } = await supabase
      .from('shop_review_requests')
      .update({ clicked_at: new Date().toISOString() })
      .eq('id', review.id)
      .is('clicked_at', null)
    if (stampError) {
      // Losing the analytics must never cost the customer the redirect.
      console.error('[review-click] could not stamp click:', stampError.message)
    }
  }

  const { data: settings } = await supabase
    .from('shop_review_settings')
    .select('google_place_id')
    .eq('shop_id', review.shop_id)
    .maybeSingle<Pick<ShopReviewSettings, 'google_place_id'>>()

  if (!settings?.google_place_id) {
    return NextResponse.redirect(FALLBACK_URL, { status: 302 })
  }

  return NextResponse.redirect(buildGoogleReviewUrl(settings.google_place_id), { status: 302 })
}

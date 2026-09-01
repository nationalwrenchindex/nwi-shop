// The two URLs a review request involves. Client-safe — the dashboard renders
// the tracking link next to each row so a manager can test it themselves.

import { absoluteUrl } from '@/lib/branding'

/**
 * Google's "write a review" deep link for a place.
 *
 * Ported verbatim from the Suite. This host/param pair is the only form that
 * opens the review composer directly rather than the business listing, so do
 * not "modernise" it to a maps.google.com URL.
 */
export function buildGoogleReviewUrl(googlePlaceId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(googlePlaceId)}`
}

/**
 * The link that actually goes in the text.
 *
 * Keyed on the request's random `token`, NOT its row id. The Suite put the row
 * id in the URL, which let anyone walking the id space stamp clicks on other
 * mechanics' requests and read which customers had been texted. A token is
 * unguessable and carries no ordering.
 */
export function buildReviewClickUrl(token: string): string {
  return absoluteUrl(`/r/${encodeURIComponent(token)}`)
}

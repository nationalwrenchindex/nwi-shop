// Product identity for NWI Shop. Anything user-visible that names the product —
// email subjects, page metadata, SMS signatures — reads from here so a rename is
// a one-file change.

export const PRODUCT_NAME = 'NWI Shop'
export const PRODUCT_TAGLINE = 'Shop management built for the people turning the wrenches.'
export const PRODUCT_DESCRIPTION =
  'Job board, bay scheduling, timeclock, inventory and shop financials in one place — built for independent repair shops and mobile fleets.'

export const SUPPORT_EMAIL = 'support@nwishop.com'
export const COMPANY_NAME = 'National Wrench Index'

/** Absolute origin, no trailing slash. Falls back to localhost in development. */
export const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
).replace(/\/+$/, '')

/** Builds an absolute URL for emails/SMS, where relative links do not work. */
export function absoluteUrl(path: string): string {
  return `${APP_URL}${path.startsWith('/') ? path : `/${path}`}`
}

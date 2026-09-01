// SERVER-ONLY. Resolves a public invoice token to the customer-safe invoice view.
//
// This is the ONLY door into an invoice without a session, so the rules are
// tight and they all live here rather than in the two callers (the page and the
// print route):
//
//   - The lookup goes through the SERVICE-ROLE client, because there is no anon
//     RLS policy on shop_jobs. The exact-token filter below is the whole
//     authorization decision, and it runs on the server where a client cannot
//     widen it.
//   - An empty or blank token is rejected before it reaches the query.
//     `.eq('invoice_public_token', '')` is a legitimate filter, and if any row
//     ever carried '' it would match every visitor to /i/.
//   - `buildInvoice` is called with `withMargins = false`, so the returned view
//     has no unit_cost, extended_cost, margin or margin_pct keys on any line
//     item and no cost totals. `InvoiceView` has no field for `job.notes` or for
//     tech pay at all, so neither has a path to the customer.
//   - Only a genuinely invoiced, non-voided job resolves. A draft estimate that
//     somehow acquired a token is not a document a customer may read.
//
// Every failure returns null so the page renders one neutral "not found" for
// "never existed", "voided", and "not invoiced yet" alike - a customer holding a
// stale link learns nothing about anyone else's jobs.

import { createServiceClient } from '@/lib/supabase/service'
import { buildInvoice, type InvoiceView } from '@/lib/shop/invoice'
import type {
  ShopCustomer,
  ShopJob,
  ShopJobLineItem,
  ShopProfile,
  ShopVehicle,
} from '@/lib/types'

export interface PublicInvoice {
  view: InvoiceView
  /** How the customer gets in touch to pay. Never an internal contact. */
  contact: {
    shopName: string
    phone:    string | null
    email:    string | null
  }
}

export async function loadPublicInvoice(rawToken: string): Promise<PublicInvoice | null> {
  const token = (rawToken ?? '').trim()
  if (!token) return null

  const svc = createServiceClient()

  // A missing invoice_public_token column (migration 009+ not applied) throws
  // here; the catch turns it into a 404 rather than a 500 on a public URL.
  let job: ShopJob | null = null
  try {
    const { data } = await svc
      .from('shop_jobs')
      .select('*')
      .eq('invoice_public_token', token)
      .limit(1)
      .returns<ShopJob[]>()
    job = data?.[0] ?? null
  } catch {
    return null
  }

  if (!job) return null
  if (job.voided) return null
  if (job.status !== 'invoiced') return null

  const [shopRes, customerRes, vehicleRes, itemsRes] = await Promise.all([
    svc.from('shop_profiles').select('*').eq('id', job.shop_id).limit(1).returns<ShopProfile[]>(),
    job.customer_id
      ? svc
          .from('shop_customers')
          .select('*')
          .eq('id', job.customer_id)
          .eq('shop_id', job.shop_id)
          .limit(1)
          .returns<ShopCustomer[]>()
      : Promise.resolve({ data: [] as ShopCustomer[] }),
    job.vehicle_id
      ? svc
          .from('shop_vehicles')
          .select('*')
          .eq('id', job.vehicle_id)
          .eq('shop_id', job.shop_id)
          .limit(1)
          .returns<ShopVehicle[]>()
      : Promise.resolve({ data: [] as ShopVehicle[] }),
    // EVERY line item, labor and parts alike - the same rows the shop billed.
    svc
      .from('shop_job_line_items')
      .select('*')
      .eq('job_id', job.id)
      .eq('shop_id', job.shop_id)
      .order('created_at', { ascending: true })
      .returns<ShopJobLineItem[]>(),
  ])

  const shop = shopRes.data?.[0] ?? null
  if (!shop) return null

  const view = buildInvoice(
    job,
    itemsRes.data ?? [],
    customerRes.data?.[0] ?? null,
    vehicleRes.data?.[0] ?? null,
    shop,
    // Never true on this path.
    false,
  )

  return {
    view,
    contact: {
      shopName: shop.business_name,
      phone:    shop.phone,
      email:    shop.email,
    },
  }
}

/** The line printed under the totals on the customer's copy. */
export function payPrompt(contact: PublicInvoice['contact'], paid: boolean): string {
  if (paid) return `Paid in full. Thank you from ${contact.shopName}.`
  const how = [contact.phone, contact.email].filter(Boolean).join(' or ')
  return how
    ? `To pay this invoice or ask a question, contact ${contact.shopName} at ${how}.`
    : `To pay this invoice, contact ${contact.shopName}.`
}

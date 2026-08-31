/**
 * Creates the NWI Shop Stripe products + recurring monthly prices, then prints
 * the resulting price ids ready to paste into .env.local.
 *
 * RUN IT YOURSELF — this script was written but deliberately never executed,
 * because STRIPE_SECRET_KEY on this project is a LIVE key and running it creates
 * real, billable objects on the production Stripe account.
 *
 *   Test-mode key:
 *     npx tsx scripts/create-stripe-products.ts --confirm
 *
 *   Live-mode key (both flags required, in addition to a live key being set):
 *     npx tsx scripts/create-stripe-products.ts --confirm --live
 *
 * Safe to re-run: every product carries a `metadata.nwi_shop_plan` marker and the
 * script searches for that marker before creating anything. An existing product
 * is reused and its active monthly price reported instead of a duplicate being
 * created.
 */

import Stripe from 'stripe'

// ---------------------------------------------------------------------------
// Product catalog. Foreman AI is its OWN product, never a tier line item — see
// the header of lib/shop/billing.ts. The dollar figures mirror TIER_PRICES /
// FOREMAN_AI_PRICE in lib/permissions.ts.
// ---------------------------------------------------------------------------

interface CatalogEntry {
  /** metadata.nwi_shop_plan marker — the idempotency key for this script. */
  marker: string
  name: string
  description: string
  /** Monthly price in whole US dollars. */
  dollars: number
  /** Env var the resulting price id belongs in. */
  envVar: string
}

const CATALOG: CatalogEntry[] = [
  {
    marker: 'starter',
    name: 'NWI Shop Starter',
    description:
      'Up to 3 techs, 2 bays and 1 mobile unit. Full inventory for the shop and the mobile unit, visual bay job board, tech timeclock and professional invoicing.',
    dollars: 119,
    envVar: 'STRIPE_PRICE_SHOP_STARTER',
  },
  {
    marker: 'pro',
    name: 'NWI Shop Pro',
    description:
      'Up to 8 techs, 6 bays and 3 mobile units. Full inventory for the shop and every service vehicle, visual bay job board, tech timeclock and professional invoicing.',
    dollars: 199,
    envVar: 'STRIPE_PRICE_SHOP_PRO',
  },
  {
    marker: 'elite',
    name: 'NWI Shop Elite',
    description:
      'Unlimited techs, bays and mobile units. Full inventory, Fleet Pro integration, and eligibility to add Foreman AI as a separate add-on.',
    dollars: 299,
    envVar: 'STRIPE_PRICE_SHOP_ELITE',
  },
  {
    marker: 'foreman_ai',
    name: 'NWI Shop Foreman AI',
    description:
      'Add-on for NWI Shop Elite, billed as a separate line item. AI diagnostic direction that reads the job, vehicle history and on-hand parts.',
    dollars: 59,
    envVar: 'STRIPE_PRICE_SHOP_FOREMAN_AI',
  },
]

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const confirmed = argv.includes('--confirm')
  const liveAcknowledged = argv.includes('--live')

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    fail('STRIPE_SECRET_KEY is not set. Load it from .env.local before running.')
  }

  const live = secretKey.startsWith('sk_live')
  const mode = live ? 'LIVE' : 'TEST'

  console.log('')
  console.log('  NWI Shop — Stripe product setup')
  console.log(`  Detected key mode: ${mode} (${secretKey.slice(0, 8)}...)`)
  console.log('')

  if (!confirmed) {
    fail(
      'Refusing to run without --confirm.\n' +
        '  Re-run as: npx tsx scripts/create-stripe-products.ts --confirm' +
        (live ? ' --live' : ''),
    )
  }

  if (live && !liveAcknowledged) {
    fail(
      'This is a LIVE key. Creating products here bills real money and cannot be\n' +
        '  fully undone. Pass --live as well to acknowledge:\n' +
        '  npx tsx scripts/create-stripe-products.ts --confirm --live',
    )
  }

  const stripe = new Stripe(secretKey)
  const results: { envVar: string; priceId: string; note: string }[] = []

  for (const entry of CATALOG) {
    // --- find an existing product by our marker -----------------------------
    const search = await stripe.products.search({
      query: `metadata['nwi_shop_plan']:'${entry.marker}'`,
      limit: 1,
    })

    let product = search.data[0]
    let created = false

    if (!product) {
      product = await stripe.products.create({
        name: entry.name,
        description: entry.description,
        metadata: { nwi_shop_plan: entry.marker },
      })
      created = true
    }

    // --- find an existing monthly USD price at the right amount -------------
    const unitAmount = entry.dollars * 100
    const prices = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 100,
    })

    let price = prices.data.find(
      (p) =>
        p.currency === 'usd' &&
        p.unit_amount === unitAmount &&
        p.recurring?.interval === 'month',
    )

    if (!price) {
      price = await stripe.prices.create({
        product: product.id,
        currency: 'usd',
        unit_amount: unitAmount,
        recurring: { interval: 'month' },
        metadata: { nwi_shop_plan: entry.marker },
      })
      created = true
    }

    results.push({
      envVar: entry.envVar,
      priceId: price.id,
      note: created ? 'created' : 'already existed — reused',
    })

    console.log(`  ${entry.name.padEnd(24)} $${entry.dollars}/mo  ${created ? 'created' : 'reused'}`)
  }

  console.log('')
  console.log('  ---------------------------------------------------------------')
  console.log(`  Paste into .env.local  (${mode} mode price ids)`)
  console.log('  ---------------------------------------------------------------')
  console.log('')
  for (const r of results) {
    console.log(`${r.envVar}=${r.priceId}`)
  }
  console.log('')
  console.log('  Reminder: Foreman AI is a SEPARATE product. Never add it to a')
  console.log('  plan price — checkout attaches it as its own line item.')
  console.log('')
}

main().catch((err: unknown) => {
  console.error('\n  Failed:', err instanceof Error ? err.message : err, '\n')
  process.exit(1)
})

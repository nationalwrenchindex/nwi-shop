import { PUBLIC_SHOP_TYPES, SHOP_TYPE_LABELS, TIER_LIMITS } from '@/lib/permissions'
import { PUBLIC_PLANS, toolNamesFor } from '@/lib/shop/billing'

/**
 * Competitor comparison.
 *
 * EDITORIAL RULE for anyone updating this table: state what NWI Shop does, and
 * describe competitors only in terms that are defensible and non-defamatory.
 * Do NOT assert specific competitor prices — their pricing is quote-based and
 * changes; "starts well above" and "quote required" are accurate positioning,
 * an invented dollar figure is not. Anything we cannot stand behind in writing
 * does not belong in this table.
 */

type Cell = string | boolean

interface Row {
  label: string
  nwi: Cell
  fullbay: Cell
  shopmonkey: Cell
}

/**
 * One row per publicly offered shop type, naming the diagnostic tools that type
 * unlocks. Generated from PUBLIC_SHOP_TYPES, so an unlisted type can never leak
 * onto this page by someone adding a row here.
 */
const SHOP_TYPE_ROWS: Row[] = PUBLIC_SHOP_TYPES.map((type) => ({
  label: `${SHOP_TYPE_LABELS[type]} diagnostic tools`,
  nwi: `${toolNamesFor(type)} — included, no extra charge`,
  fullbay: 'Varies',
  shopmonkey: 'Varies',
}))

const ROWS: Row[] = [
  {
    label: 'Published flat monthly price',
    nwi: `From $${PUBLIC_PLANS.starter.price}/mo`,
    fullbay: 'Quote required',
    shopmonkey: 'Quote required',
  },
  {
    label: 'Entry price point',
    nwi: `$${PUBLIC_PLANS.starter.price}/mo, listed publicly`,
    fullbay: 'Starts well above ours',
    shopmonkey: 'Starts well above ours',
  },
  ...SHOP_TYPE_ROWS,
  { label: 'Visual bay job board',              nwi: true, fullbay: true,  shopmonkey: true },
  { label: 'Tech timeclock included',           nwi: true, fullbay: true,  shopmonkey: true },
  {
    label: 'Separate mobile-unit inventory',
    nwi: 'Every plan, including Starter',
    fullbay: 'Varies by plan',
    shopmonkey: 'Varies by plan',
  },
  {
    label: 'Mobile units on the entry plan',
    nwi: `${TIER_LIMITS.starter.mobileUnits ?? 'Unlimited'} included`,
    fullbay: 'Varies by plan',
    shopmonkey: 'Varies by plan',
  },
  {
    label: 'Unlimited techs and bays',
    nwi: `Included on ${PUBLIC_PLANS.elite.label} at $${PUBLIC_PLANS.elite.price}/mo`,
    fullbay: 'Priced per tech',
    shopmonkey: 'Priced per user',
  },
  { label: 'Fleet Pro integration',             nwi: 'Elite', fullbay: false, shopmonkey: false },
  {
    label: 'AI shop foreman',
    nwi: 'Optional $59/mo add-on',
    fullbay: false,
    shopmonkey: false,
  },
  { label: 'No annual contract',                nwi: true, fullbay: 'Varies', shopmonkey: 'Varies' },
]

/**
 * Shown only while charter spots remain. Once the 50 are claimed the program is
 * closed to new shops, so keeping it in the table would be stale marketing —
 * every charter callout on this page disappears together at 0.
 */
const CHARTER_ROW: Row = {
  label: 'Price locked forever for charter members',
  nwi: true,
  fullbay: false,
  shopmonkey: false,
}

function CellValue({ value, emphasis }: { value: Cell; emphasis?: boolean }) {
  if (value === true) {
    return (
      <span
        className={emphasis ? 'font-bold text-amber-400' : 'font-semibold text-slate-200'}
      >
        <span aria-hidden>✓</span>
        <span className="sr-only">Yes</span>
      </span>
    )
  }
  if (value === false) {
    return (
      <span className="text-slate-600">
        <span aria-hidden>—</span>
        <span className="sr-only">Not offered</span>
      </span>
    )
  }
  return (
    <span className={emphasis ? 'font-semibold text-white' : 'text-slate-400'}>
      {value}
    </span>
  )
}

export default function Comparison({ slotsRemaining }: { slotsRemaining: number }) {
  const rows = slotsRemaining > 0 ? [...ROWS, CHARTER_ROW] : ROWS

  return (
    <section className="bg-slate-950">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">
            How we stack up
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            Same job. Published price. No sales call.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-slate-400">
            Our number is on this page. You can read it, decide, and be running today —
            without a demo, a discovery call or a per-seat negotiation.
          </p>
        </div>

        <div className="mt-14 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/15">
                <th scope="col" className="py-4 pr-4 font-normal text-slate-500">
                  <span className="sr-only">Capability</span>
                </th>
                <th
                  scope="col"
                  className="w-1/4 rounded-t-xl bg-amber-500/10 px-4 py-4 text-base font-bold text-white"
                >
                  NWI Shop
                </th>
                <th scope="col" className="w-1/4 px-4 py-4 text-base font-semibold text-slate-400">
                  Fullbay<sup className="text-[10px]">†</sup>
                </th>
                <th scope="col" className="w-1/4 px-4 py-4 text-base font-semibold text-slate-400">
                  ShopMonkey<sup className="text-[10px]">†</sup>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-white/10">
                  <th
                    scope="row"
                    className="py-4 pr-4 align-top font-medium text-slate-300"
                  >
                    {row.label}
                  </th>
                  <td className="bg-amber-500/10 px-4 py-4 align-top">
                    <CellValue value={row.nwi} emphasis />
                  </td>
                  <td className="px-4 py-4 align-top">
                    <CellValue value={row.fullbay} />
                  </td>
                  <td className="px-4 py-4 align-top">
                    <CellValue value={row.shopmonkey} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-8 max-w-3xl text-xs leading-relaxed text-slate-500">
          <span aria-hidden>†</span> Fullbay is a trademark of Fullbay, Inc. ShopMonkey
          is a trademark of Shopmonkey, Inc. Neither company is affiliated with,
          sponsors, or endorses NWI Shop. Comparisons describe NWI Shop&apos;s own
          capabilities alongside publicly available positioning for those products as
          of {new Date().getFullYear()}; because their plans are quoted rather than
          listed, we do not state their prices. Confirm current details with each
          vendor before deciding.
        </p>
      </div>
    </section>
  )
}

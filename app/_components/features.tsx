import { PUBLIC_SHOP_TYPES, SHOP_TYPE_LABELS } from '@/lib/permissions'
import { toolNamesFor } from '@/lib/shop/billing'

interface Feature {
  eyebrow: string
  title: string
  body: string
  points: string[]
}

const FEATURES: Feature[] = [
  {
    eyebrow: 'Bay management',
    title: 'A job board that looks like your shop.',
    body: 'Every bay is a column. Drag a job into a bay and it is assigned, timed and visible to the whole floor. Walk in at 7am and know exactly what is on the lifts.',
    points: [
      'Drag-and-drop jobs onto real bays',
      'Live status: estimate, approved, in progress, completed',
      'Bay occupancy and turn time at a glance',
    ],
  },
  {
    eyebrow: 'Tech timeclock',
    title: 'Hours captured on the job, not on a clipboard.',
    body: 'Techs punch into the shop and into individual jobs from a tablet at the bay. Labor hours land on the work order automatically, so billable time stops evaporating.',
    points: [
      'Shop punches and per-job punches',
      'Labor time flows straight onto the invoice',
      'Payroll-ready hours by tech, no re-keying',
    ],
  },
  {
    eyebrow: 'Inventory',
    title: 'Parts on the shelf and parts on the truck.',
    body: 'Track stock in the shop and on every service vehicle as separate locations. Pull a part to a job and the count drops, the cost lands, and the reorder point tells you before you run out.',
    points: [
      'Separate shop and mobile-unit stock',
      'Reorder points with low-stock flags',
      'Cost and margin visible to managers only',
    ],
  },
  {
    eyebrow: 'Invoicing',
    title: 'Invoices that look like a real shop sent them.',
    body: 'Labor and parts flow from the work order into a clean, itemized invoice with your logo, your labor rate and your tax rate. Estimate to approval to invoice without retyping a line.',
    points: [
      'Estimate → approval → invoice in one record',
      'Your logo, labor rate and tax rate',
      'Itemized labor and parts, ready to send',
    ],
  },
  {
    eyebrow: 'Diagnostics',
    title: 'The tools match the trucks in your bays.',
    body: 'Pick light duty or heavy duty when you sign up and the diagnostic tools come with it — on every plan, at the same price. Heavy duty shops get the trailer, reefer and compliance side too, not a car-shop tool with a truck label on it.',
    // Generated from PUBLIC_SHOP_TYPES so this section can only ever name the
    // types we sell publicly — nothing unlisted can leak onto the landing page.
    points: PUBLIC_SHOP_TYPES.map(
      (type) => `${SHOP_TYPE_LABELS[type]}: ${toolNamesFor(type)}`,
    ),
  },
  {
    eyebrow: 'Fleet Pro integration',
    title: 'Fleet work stops living in a separate spreadsheet.',
    body: 'Elite shops connect to Fleet Pro so fleet customers, unit numbers and service history line up with the work orders your techs are already writing.',
    points: [
      'Fleet units matched to customer vehicles',
      'Service history that follows the unit',
      'Included with NWI Shop Elite',
    ],
  },
]

export default function Features() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-600">
            What you get
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
            Everything the shop runs on. One place.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-slate-600">
            Not a CRM with a repair module bolted on. The board, the clock, the parts
            and the paper — built together, because that is how a shop actually works.
          </p>
        </div>

        <div className="mt-20 space-y-20">
          {FEATURES.map((feature, index) => (
            <div
              key={feature.eyebrow}
              className="grid items-start gap-8 border-t border-slate-200 pt-10 lg:grid-cols-12 lg:gap-16"
            >
              <div className="lg:col-span-5">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-600">
                  <span className="mr-3 text-slate-400">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {feature.eyebrow}
                </p>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                  {feature.title}
                </h3>
              </div>

              <div className="lg:col-span-7">
                <p className="text-base leading-relaxed text-slate-600 sm:text-lg">
                  {feature.body}
                </p>
                <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                  {feature.points.map((point) => (
                    <li
                      key={point}
                      className="flex gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800"
                    >
                      <span aria-hidden className="mt-0.5 font-bold text-amber-600">
                        ✓
                      </span>
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

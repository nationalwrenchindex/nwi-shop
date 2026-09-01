// The public, login-free invoice a customer opens from a text or an email.
//
// It lives at /i/[token], deliberately OUTSIDE /shop, because everything under
// /shop requires a session. See the note in the report: `/i` still has to be
// added to PUBLIC_PREFIXES in proxy.ts (this feature does not own that file), or
// an unauthenticated customer is bounced to /login.
//
// WHAT A CUSTOMER MAY SEE: their own name and vehicle, what was requested, the
// labor and parts they were billed for at the prices they were billed, the
// totals, and how to pay. WHAT THEY MAY NOT: unit cost, extended cost, margin,
// tech pay, which tech did the work, and the shop's internal notes. That is
// enforced in `loadPublicInvoice` (withMargins is hard-coded false) and in the
// shape of `InvoiceView` itself, not by what this file happens to render.

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { money } from '@/lib/shop/jobs'
import {
  formatInvoiceDate,
  invoiceLabel,
  round2AsPercent,
  type InvoiceView,
} from '@/lib/shop/invoice'
import { loadPublicInvoice, payPrompt } from './_data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Invoice',
  // A capability URL must never be handed to a crawler.
  robots: { index: false, follow: false },
}

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const result = await loadPublicInvoice(token)
  // One neutral 404 for every failure mode - see _data.ts.
  if (!result) notFound()

  const { view, contact } = result
  const paid = !!view.paidAt

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="nwi-card overflow-hidden">
        {/* ---- header ---- */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 p-5 sm:p-6">
          <div className="min-w-0">
            <h1 className="text-xl font-black tracking-tight text-slate-900">{contact.shopName}</h1>
            {view.shop.lines.map((line) => (
              <p key={line} className="text-sm text-slate-600">
                {line}
              </p>
            ))}
            {contact.phone && <p className="text-sm text-slate-600">{contact.phone}</p>}
          </div>
          <div className="text-right">
            <p className="font-mono text-lg font-black text-slate-900">{invoiceLabel(view)}</p>
            <p className="text-sm text-slate-600">{formatInvoiceDate(view.invoiceDate)}</p>
            <span
              className={`mt-1 inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                paid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
              }`}
            >
              {paid ? 'Paid' : 'Amount due'}
            </span>
          </div>
        </header>

        {/* ---- amount ---- */}
        <div className="border-b border-slate-200 p-5 sm:p-6">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
            {paid ? 'Total paid' : 'Total due'}
          </p>
          <p className="font-mono text-4xl font-black tabular-nums text-slate-900">
            {money(view.totals.total)}
          </p>
          {paid && (
            <p className="mt-1 text-sm font-semibold text-emerald-800">
              Paid {formatInvoiceDate(view.paidAt)}
            </p>
          )}
        </div>

        {/* ---- who / what ---- */}
        <div className="grid grid-cols-1 gap-5 border-b border-slate-200 p-5 sm:grid-cols-2 sm:p-6">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Bill to</h2>
            <p className="mt-1 font-semibold text-slate-900">{view.customer.name}</p>
            {view.customer.lines.map((line) => (
              <p key={line} className="text-sm text-slate-700">
                {line}
              </p>
            ))}
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Vehicle</h2>
            <p className="mt-1 font-semibold text-slate-900">{view.vehicle.label}</p>
            {view.vehicle.vin && (
              <p className="text-sm text-slate-600">VIN {view.vehicle.vin}</p>
            )}
            {view.vehicle.mileage !== null && (
              <p className="text-sm text-slate-600">
                {view.vehicle.mileage.toLocaleString('en-US')} mi
              </p>
            )}
          </div>
        </div>

        {(view.complaint || view.description) && (
          <div className="border-b border-slate-200 p-5 sm:p-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Work requested
            </h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
              {view.complaint || view.description}
            </p>
          </div>
        )}

        <PublicLines title="Labor" unit="hrs" items={view.labor} />
        <PublicLines title="Parts" unit="ea" items={view.parts} />

        {/* ---- totals ---- */}
        <div className="border-b border-slate-200 p-5 sm:p-6">
          <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
            <TotalRow label={`Labor (${view.totals.laborHours} hrs)`} value={money(view.totals.laborTotal)} />
            <TotalRow label="Parts" value={money(view.totals.partsTotal)} />
            <TotalRow label="Subtotal" value={money(view.totals.subtotal)} />
            <TotalRow
              label={`Sales tax (${round2AsPercent(view.totals.taxRate)}%)`}
              value={money(view.totals.tax)}
            />
            <div className="flex justify-between gap-3 border-t-2 border-slate-900 pt-2 text-base font-black text-slate-900">
              <dt>Total</dt>
              <dd className="font-mono tabular-nums">{money(view.totals.total)}</dd>
            </div>
          </dl>
        </div>

        {/* ---- pay / contact ---- */}
        <div className="p-5 sm:p-6">
          <p className="text-sm font-semibold text-slate-800">{payPrompt(contact, paid)}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {contact.phone && (
              <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="nwi-btn nwi-btn-primary">
                Call {contact.shopName}
              </a>
            )}
            {contact.email && (
              <a
                href={`mailto:${contact.email}?subject=${encodeURIComponent(`Invoice ${invoiceLabel(view)}`)}`}
                className="nwi-btn nwi-btn-secondary"
              >
                Email the shop
              </a>
            )}
            <a
              href={`/i/${view.publicToken ?? ''}/print`}
              target="_blank"
              rel="noopener noreferrer"
              className="nwi-btn nwi-btn-secondary"
            >
              Print / Save as PDF
            </a>
          </div>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">
        Questions about a charge? Contact {contact.shopName} directly.
      </p>
    </main>
  )
}

/**
 * Line items as a customer sees them: description, how many, the price they were
 * charged, the amount. `items` physically has no cost keys on this path.
 */
function PublicLines({
  title,
  unit,
  items,
}: {
  title: string
  unit: string
  items: InvoiceView['labor']
}) {
  if (items.length === 0) return null
  return (
    <div className="border-b border-slate-200 p-5 sm:p-6">
      <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">{title}</h2>
      <ul className="mt-2 divide-y divide-slate-100">
        {items.map((item) => (
          <li key={item.id} className="flex items-baseline justify-between gap-4 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">{item.description}</p>
              <p className="text-xs text-slate-500">
                {item.quantity} {unit} @ {money(item.unit_price)}
                {item.part_number ? ` · ${item.part_number}` : ''}
              </p>
            </div>
            <p className="shrink-0 font-mono text-sm font-semibold tabular-nums text-slate-900">
              {money(item.total)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-mono tabular-nums text-slate-900">{value}</dd>
    </div>
  )
}

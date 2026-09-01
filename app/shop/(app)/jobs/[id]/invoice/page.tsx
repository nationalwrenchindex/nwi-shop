// The invoice preview: what the customer will get, plus the actions that put it
// in their hands — Print, Send, Mark paid, and the one-click convert for a work
// order that has not been invoiced yet.
//
// Cost and margin columns appear only for `permissions.viewMargins`, and the
// redaction happens on the SERVER: `buildInvoice` runs the line items through
// `toLineItemView`, so a foreman's page is rendered from data that has no cost
// keys on it at all. Nothing is hidden with CSS.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { loadJobDetail, money } from '@/lib/shop/jobs'
import {
  buildInvoice,
  canInvoice,
  formatInvoiceDate,
  invoiceLabel,
  round2AsPercent,
} from '@/lib/shop/invoice'
import LineItemsTable from '../../_components/line-items-table'
import InvoiceActions from './_components/invoice-actions'

export const metadata: Metadata = { title: 'Invoice' }

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Invoicing is a manager/foreman action. A tech never reaches this page, and
  // the API behind every button on it re-checks the same permission.
  const ctx = await requirePermission('viewAllJobs')
  const supabase = await createClient()

  const detail = await loadJobDetail(supabase, id, { shopId: ctx.shop.id, techId: null })
  if (!detail) notFound()

  const showMargins = ctx.permissions.viewMargins
  const view = buildInvoice(
    detail.job,
    detail.lineItems,
    detail.customer,
    detail.vehicle,
    ctx.shop,
    showMargins,
  )

  const gate = canInvoice(detail.job)
  const converted = view.status === 'invoiced'
  // The job reached `invoiced` but carries no number: migration 009+ has not been
  // applied. Say so rather than rendering a blank invoice number.
  const degraded = converted && !view.invoiceNumber

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Link
        href={`/shop/jobs/${view.jobId}`}
        className="inline-block text-sm font-semibold text-slate-600 underline-offset-4 hover:underline"
      >
        &larr; Back to job #{view.jobNumber}
      </Link>

      {/* ---- header ---- */}
      <header className="nwi-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Invoice</p>
            <h1 className="font-mono text-3xl font-black tracking-tight text-slate-900">
              {invoiceLabel(view)}
            </h1>
            <p className="mt-2 text-lg font-semibold text-slate-900">{view.customer.name}</p>
            <p className="text-sm text-slate-600">{view.vehicle.label}</p>
          </div>

          <div className="flex flex-col items-end gap-2">
            {view.paidAt ? (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold uppercase text-emerald-800">
                Paid {formatInvoiceDate(view.paidAt)}
              </span>
            ) : converted ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold uppercase text-amber-900">
                Due
              </span>
            ) : (
              <span className="rounded-full bg-slate-200 px-3 py-1 text-sm font-bold uppercase text-slate-700">
                Not invoiced
              </span>
            )}
            <p className="text-right font-mono text-2xl font-black tabular-nums text-slate-900">
              {money(view.totals.total)}
            </p>
          </div>
        </div>
      </header>

      {degraded && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          This job is marked invoiced, but no invoice number or public link could be stored.
          The invoice columns migration has not been applied to this database yet.
        </p>
      )}

      {!gate.ok && (
        <p className="rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          {gate.reason}
        </p>
      )}

      <InvoiceActions
        jobId={view.jobId}
        converted={converted}
        canConvert={gate.ok && !converted}
        hasLineItems={detail.lineItems.length > 0}
        paid={!!view.paidAt}
        publicUrl={view.publicUrl}
        sentAt={view.sentAt}
        customerEmail={view.customer.email}
        customerPhone={view.customer.phone}
        noEmail={!!detail.customer?.no_email}
        noSms={!!detail.customer?.no_sms}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <LineItemsTable
            title={`Labor - ${view.totals.laborHours} hrs`}
            items={view.labor}
            quantityLabel="Hours"
            showMargins={showMargins}
          />
          <LineItemsTable
            title="Parts"
            items={view.parts}
            quantityLabel="Qty"
            showMargins={showMargins}
          />

          {(view.complaint || view.description) && (
            <section className="nwi-card p-4 sm:p-5">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Work requested
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                {view.complaint || view.description}
              </p>
            </section>
          )}
        </div>

        {/* ---- right rail ---- */}
        <div className="space-y-6">
          <section className="nwi-card p-4 sm:p-5">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Totals</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label={`Labor (${view.totals.laborHours} hrs)`} value={money(view.totals.laborTotal)} />
              <Row label="Parts" value={money(view.totals.partsTotal)} />
              <Row label="Subtotal" value={money(view.totals.subtotal)} />
              {/* Tax is charged on PARTS ONLY - see the tax note in lib/shop/invoice.ts. */}
              <Row
                label={`Tax on parts (${round2AsPercent(view.totals.taxRate)}%)`}
                value={money(view.totals.tax)}
              />
              <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
                <dt>Total</dt>
                <dd className="font-mono tabular-nums">{money(view.totals.total)}</dd>
              </div>
              {view.totals.margin !== undefined && (
                <div className="mt-2 space-y-2 border-t border-slate-200 pt-2">
                  <Row label="Cost" value={money(view.totals.costTotal ?? 0)} />
                  <Row
                    label="Margin"
                    value={`${money(view.totals.margin)} (${view.totals.marginPct ?? 0}%)`}
                  />
                </div>
              )}
            </dl>
          </section>

          <section className="nwi-card p-4 sm:p-5">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Bill to</h3>
            <div className="mt-3 space-y-1 text-sm text-slate-800">
              <p className="font-semibold text-slate-900">{view.customer.name}</p>
              {view.customer.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <p>{view.customer.phone ?? '--'}</p>
              <p className="break-all">{view.customer.email ?? '--'}</p>
            </div>
          </section>

          <section className="nwi-card p-4 sm:p-5">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Invoice</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Number" value={view.invoiceNumber ?? '--'} />
              <Row label="Date" value={formatInvoiceDate(view.invoiceDate)} />
              <Row label="Sent" value={formatInvoiceDate(view.sentAt)} />
              <Row label="Paid" value={formatInvoiceDate(view.paidAt)} />
              <Row label="Work order" value={`#${view.jobNumber}`} />
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-mono tabular-nums text-slate-900">{value}</dd>
    </div>
  )
}

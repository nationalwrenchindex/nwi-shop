// Work order -> invoice. This module is the single source of truth for what an
// NWI Shop invoice IS, what it totals to, and how it prints.
//
// THE SHAPE OF AN INVOICE HERE
// There is no `shop_invoices` table. An invoice is a `shop_jobs` row that has
// reached status `invoiced`, plus the four columns migration 009+ adds to it
// (`invoice_number`, `invoice_sent_at`, `invoice_public_token`, `paid_at`). Its
// money lives entirely in `shop_job_line_items` — the same rows the job board
// wrote. Converting a work order therefore never COPIES line items into a second
// table and so can never lose one: every labor row and every part row a tech
// added is carried through by construction. `buildInvoice` takes the whole
// `shop_job_line_items` set and splits it by `type`; there is no code path in
// this file that synthesizes a labor line from `estimated_hours * labor_rate`,
// which is how the HD Suite silently dropped every part a tech had added.
//
// TAX POLICY
// The shop's tax rate is applied to PARTS ONLY, matching `lib/shop/quickbooks.ts`
// (automotive labor is untaxed in most states, and `shop_jobs` carries no
// per-invoice tax column to defer to). This deliberately differs from
// `summarizeLineItems` in `lib/shop/jobs.ts`, which taxes the whole subtotal for
// the job-board estimate card. The INVOICE is the billed document and the
// QuickBooks export is generated from the same jobs, so the invoice follows the
// export, not the estimate.
//
// COST NEVER PRINTS
// `InvoiceView` carries cost/margin only when the caller passes `withMargins`
// (their `permissions.viewMargins`), and `renderInvoiceHtml` ignores those keys
// entirely — the printable document and the public customer view are the same
// renderer, so there is no variant of it that can leak cost. `job.notes` is not
// on `InvoiceView` at all: internal notes have no field to leak through.
//
// This file is free of `next/headers` and of any Supabase client construction —
// the query helpers take an already-built client, exactly like `lib/shop/jobs.ts`.

import type { SupabaseClient } from '@supabase/supabase-js'
import { APP_URL } from '@/lib/branding'
import {
  money,
  round2,
  taxAmount,
  toLineItemView,
  customerName,
  vehicleLabel,
  type JobLineItemView,
} from '@/lib/shop/jobs'
import type {
  JobStatus,
  ShopCustomer,
  ShopJob,
  ShopJobLineItem,
  ShopProfile,
  ShopVehicle,
} from '@/lib/types'

// ---------------------------------------------------------------------------
// The columns migration 009+ adds to shop_jobs.
//
// They are declared as OPTIONAL rather than nullable because a shop running
// against a database where the migration has not been applied yet gets a row
// with the keys absent, not null. Every read below treats `undefined` and `null`
// the same, so the job page and the invoice page degrade to "not invoiced yet"
// instead of throwing.
// ---------------------------------------------------------------------------

export interface InvoiceFields {
  invoice_number:       string | null
  invoice_sent_at:      string | null
  invoice_public_token: string | null
  paid_at:              string | null
}

export type InvoicedJob = ShopJob & Partial<InvoiceFields>

/**
 * `loadJobDetail` selects `*`, so a row read through it already carries these
 * columns at runtime once the migration lands. This is the one cast that admits
 * that, kept in a named function so it is greppable.
 */
export function asInvoicedJob(job: ShopJob): InvoicedJob {
  return job as InvoicedJob
}

export function invoiceFieldsOf(job: ShopJob): InvoiceFields {
  const row = job as InvoicedJob
  return {
    invoice_number:       row.invoice_number ?? null,
    invoice_sent_at:      row.invoice_sent_at ?? null,
    invoice_public_token: row.invoice_public_token ?? null,
    paid_at:              row.paid_at ?? null,
  }
}

/** True once the job has been converted and carries a number. */
export function isInvoiced(job: ShopJob): boolean {
  return job.status === 'invoiced' && !!invoiceFieldsOf(job).invoice_number
}

/**
 * A job may be converted from `completed` (the real conversion) or from
 * `invoiced` (regeneration — reprinting or re-sending an existing invoice).
 * A voided job can never be invoiced.
 */
export function canInvoice(job: ShopJob): { ok: boolean; reason: string | null } {
  if (job.voided) return { ok: false, reason: 'This job has been voided.' }
  if (job.status === 'completed' || job.status === 'invoiced') {
    return { ok: true, reason: null }
  }
  return { ok: false, reason: 'Finish the work order before invoicing it.' }
}

// ---------------------------------------------------------------------------
// Postgres / PostgREST error shapes.
//
// Migration 009+ is written concurrently with this feature. Until it is applied,
// writing `invoice_number` fails with "column does not exist" and re-reading
// fails with the schema-cache variant. Neither may crash the job page, so both
// are recognised and reported as a degraded (not failed) conversion.
// ---------------------------------------------------------------------------

interface PgErrorLike {
  code?:    string | null
  message?: string | null
}

function pgError(err: unknown): PgErrorLike | null {
  if (!err || typeof err !== 'object') return null
  return err as PgErrorLike
}

/** 42703 = undefined_column; PGRST204 = column missing from the schema cache. */
export function isMissingColumnError(err: unknown): boolean {
  const e = pgError(err)
  if (!e) return false
  if (e.code === '42703' || e.code === 'PGRST204') return true
  const msg = (e.message ?? '').toLowerCase()
  return (
    msg.includes('does not exist') && msg.includes('column')
  ) || msg.includes("could not find the 'invoice")
}

/** 23505 = unique_violation — two conversions raced for the same number. */
export function isUniqueViolation(err: unknown): boolean {
  const e = pgError(err)
  if (!e) return false
  if (e.code === '23505') return true
  return (e.message ?? '').toLowerCase().includes('duplicate key value')
}

// ---------------------------------------------------------------------------
// Invoice numbering.
//
// RACE SAFETY — the choice and why:
// The HD Suite numbered invoices `COUNT(*) + 1` in three separate places, so two
// managers clicking "invoice" in the same second both read the same count and
// both minted the same number, with nothing in the database to stop them.
//
// This build takes the DB UNIQUE INDEX on (shop_id, invoice_number) as the
// guarantee and RETRIES on 23505, rather than taking a Postgres advisory lock.
// The reason is that an advisory lock needs `pg_advisory_xact_lock` inside a
// transaction, and PostgREST gives a Next route neither: every `supabase-js`
// call is its own autocommitted statement, so a lock taken in one call is
// released before the next one runs. Getting a real lock would mean adding a
// SECURITY DEFINER SQL function — and `supabase/**` belongs to another agent in
// this build, so this feature cannot ship one.
//
// The unique index is strictly stronger anyway: it holds even against a writer
// that forgets to take the lock (a backfill script, a psql session, a future
// route), whereas an advisory lock only binds the callers that agree to use it.
// The retry loop below turns the constraint into a correct allocator: read the
// current maximum, attempt the write guarded by `.is('invoice_number', null)`,
// and on collision re-read and try the next number.
//
// FORMAT: INV-{year}-{seq}, seq zero-padded to 5 digits, allocated per shop per
// year. The padding matters: it keeps LEXICAL order equal to NUMERIC order, so
// `order('invoice_number', desc).limit(1)` genuinely returns the highest number
// without scanning the year. That invariant holds to 99,999 invoices for one
// shop in one calendar year.
// ---------------------------------------------------------------------------

const SEQ_PAD = 5

export function invoiceNumberPrefix(now: Date = new Date()): string {
  return `INV-${now.getUTCFullYear()}-`
}

export function formatInvoiceNumber(prefix: string, seq: number): string {
  return `${prefix}${String(Math.max(1, Math.trunc(seq))).padStart(SEQ_PAD, '0')}`
}

/** Parses the sequence out of `INV-2026-00042`, or null for a foreign format. */
export function parseInvoiceSeq(value: string | null | undefined, prefix: string): number | null {
  if (!value || !value.startsWith(prefix)) return null
  const n = Number(value.slice(prefix.length))
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * The next unused number for this shop and year. Not a reservation — the caller
 * must write it under the unique index and retry on 23505 (see `POST` in
 * app/api/shop/jobs/[id]/invoice/route.ts).
 */
export async function nextInvoiceNumber(
  supabase: SupabaseClient,
  shopId: string,
  now: Date = new Date(),
): Promise<string> {
  const prefix = invoiceNumberPrefix(now)

  const { data } = await supabase
    .from('shop_jobs')
    .select('invoice_number')
    .eq('shop_id', shopId)
    .like('invoice_number', `${prefix}%`)
    .order('invoice_number', { ascending: false })
    .limit(1)
    .returns<{ invoice_number: string | null }[]>()

  const highest = parseInvoiceSeq(data?.[0]?.invoice_number ?? null, prefix) ?? 0
  return formatInvoiceNumber(prefix, highest + 1)
}

// ---------------------------------------------------------------------------
// Public token.
//
// This is a CAPABILITY URL: whoever holds it reads the invoice with no login, so
// it must be unguessable and must never be derived from the job id, the job
// number or the invoice number — all three are enumerable and all three are
// printed on the paper copy the customer walks out with.
//
// 32 bytes / 256 bits via Web Crypto (available in Node 19+ and on the edge, so
// this module stays free of a `node:crypto` import and remains safe to pull into
// any runtime). The token travels through SMS and never expires; 64 hex
// characters is a cheap price for that.
// ---------------------------------------------------------------------------

export function newPublicToken(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Absolute, login-free URL for a minted token. Safe to put in an SMS body. */
export function publicInvoiceUrl(token: string): string {
  return `${APP_URL}/i/${token}`
}

// ---------------------------------------------------------------------------
// The view model
// ---------------------------------------------------------------------------

export interface InvoiceParty {
  name:  string
  /** Address lines, already assembled and blank-filtered. */
  lines: string[]
  phone: string | null
  email: string | null
}

export interface InvoiceVehicle {
  label:      string
  vin:        string | null
  unitNumber: string | null
  mileage:    number | null
}

export interface InvoiceTotals {
  laborHours: number
  laborTotal: number
  partsTotal: number
  subtotal:   number
  /** The fraction actually applied to parts, e.g. 0.07 — never the raw 7. */
  taxRate:    number
  tax:        number
  total:      number
  /** Present only when the caller has `permissions.viewMargins`. */
  costTotal?: number
  margin?:    number
  marginPct?: number
}

export interface InvoiceView {
  jobId:         string
  jobNumber:     number
  status:        JobStatus
  voided:        boolean
  invoiceNumber: string | null
  /** invoiced_at, falling back to completed_at then created_at. */
  invoiceDate:   string
  sentAt:        string | null
  paidAt:        string | null
  publicToken:   string | null
  publicUrl:     string | null
  shop:          InvoiceParty
  customer:      InvoiceParty
  vehicle:       InvoiceVehicle
  /** Customer-facing job text only. `job.notes` is deliberately not carried. */
  complaint:     string | null
  description:   string | null
  labor:         JobLineItemView[]
  parts:         JobLineItemView[]
  totals:        InvoiceTotals
  showMargins:   boolean
}

function addressLines(
  src: Pick<ShopCustomer, 'address' | 'city' | 'state' | 'zip'> | Pick<ShopProfile, 'address' | 'city' | 'state' | 'zip'>,
): string[] {
  const cityLine = [src.city, [src.state, src.zip].filter(Boolean).join(' ').trim()]
    .filter((part) => part && part.length > 0)
    .join(', ')
  return [src.address, cityLine].filter((line): line is string => !!line && line.trim().length > 0)
}

/**
 * Totals for the billed document. Parts are taxed, labor is not — see the TAX
 * POLICY note at the top of this file. `taxAmount` is reused from
 * `lib/shop/jobs.ts` so the 7-vs-0.07 ambiguity is resolved in exactly one place.
 */
export function invoiceTotals(
  items: JobLineItemView[],
  taxRate: number,
  withMargins: boolean,
): InvoiceTotals {
  let laborHours = 0
  let laborTotal = 0
  let partsTotal = 0
  let costTotal = 0

  for (const item of items) {
    if (item.type === 'labor') {
      laborHours += item.quantity
      laborTotal += item.total
    } else {
      partsTotal += item.total
    }
    costTotal += item.extended_cost ?? 0
  }

  laborTotal = round2(laborTotal)
  partsTotal = round2(partsTotal)
  const subtotal = round2(laborTotal + partsTotal)
  const tax = taxAmount(partsTotal, taxRate)

  const totals: InvoiceTotals = {
    laborHours: round2(laborHours),
    laborTotal,
    partsTotal,
    subtotal,
    taxRate:    taxRate > 1 ? taxRate / 100 : taxRate,
    tax,
    total:      round2(subtotal + tax),
  }
  if (!withMargins) return totals

  const margin = round2(subtotal - costTotal)
  return {
    ...totals,
    costTotal: round2(costTotal),
    margin,
    marginPct: subtotal > 0 ? round2((margin / subtotal) * 100) : 0,
  }
}

/**
 * The whole invoice, assembled from the job and EVERY one of its line items.
 *
 * `withMargins` must be the caller's `permissions.viewMargins`; when it is false
 * the line items come back through `toLineItemView` with no cost keys at all, so
 * a foreman's payload has no cost to leak downstream.
 */
export function buildInvoice(
  job: ShopJob,
  lineItems: ShopJobLineItem[],
  customer: ShopCustomer | null,
  vehicle: ShopVehicle | null,
  shop: ShopProfile,
  withMargins = false,
): InvoiceView {
  const fields = invoiceFieldsOf(job)

  // Every row, both types. Nothing is filtered, nothing is synthesized.
  const items = lineItems.map((row) => toLineItemView(row, withMargins))
  const token = fields.invoice_public_token

  return {
    jobId:         job.id,
    jobNumber:     job.job_number,
    status:        job.status,
    voided:        job.voided,
    invoiceNumber: fields.invoice_number,
    invoiceDate:   job.invoiced_at ?? job.completed_at ?? job.created_at,
    sentAt:        fields.invoice_sent_at,
    paidAt:        fields.paid_at,
    publicToken:   token,
    publicUrl:     token ? publicInvoiceUrl(token) : null,
    shop: {
      name:  shop.business_name,
      lines: addressLines(shop),
      phone: shop.phone,
      email: shop.email,
    },
    customer: {
      name:  customerName(customer),
      lines: customer ? addressLines(customer) : [],
      phone: customer?.phone ?? null,
      email: customer?.email ?? null,
    },
    vehicle: {
      label:      vehicleLabel(vehicle),
      vin:        vehicle?.vin ?? null,
      unitNumber: vehicle?.unit_number ?? null,
      mileage:    vehicle?.mileage ?? null,
    },
    complaint:   job.complaint,
    description: job.description,
    labor:       items.filter((item) => item.type === 'labor'),
    parts:       items.filter((item) => item.type === 'part'),
    totals:      invoiceTotals(items, shop.tax_rate, withMargins),
    showMargins: withMargins,
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Escapes a value before it is interpolated into the invoice document.
 *
 * The HD Suite's PDF route interpolated `customer_name`, part descriptions and
 * job notes RAW into its HTML — a part described as `<script>...` executed for
 * whoever opened the invoice, including the customer on the public link. Every
 * user-supplied string below goes through here. The single quote is escaped too
 * because some values land inside attribute contexts.
 */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c)
}

/** A stored tax FRACTION as a display percentage: 0.07 -> 7. */
export function round2AsPercent(fraction: number): number {
  return round2(fraction * 100)
}

export function formatInvoiceDate(value: string | null | undefined): string {
  if (!value) return '--'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '--'
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

/** The label printed as the document's number: the invoice number, else the job. */
export function invoiceLabel(view: InvoiceView): string {
  return view.invoiceNumber ?? `Job #${view.jobNumber}`
}

function lineRow(item: JobLineItemView, quantityUnit: string): string {
  const sub = item.part_number
    ? `<br><span class="muted">${esc(item.part_number)}</span>`
    : ''
  return `<tr>
    <td>${esc(item.description)}${sub}</td>
    <td class="num">${esc(item.quantity)} ${esc(quantityUnit)}</td>
    <td class="num">${esc(money(item.unit_price))}</td>
    <td class="num strong">${esc(money(item.total))}</td>
  </tr>`
}

function totalsRow(label: string, value: string, cls = ''): string {
  return `<div class="trow ${cls}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`
}

export interface RenderOptions {
  /** Shows the "Print / Save as PDF" bar. Off for a headless render. */
  printButton?: boolean
  /** Extra line under the footer, e.g. a "call us to pay" prompt. */
  payPrompt?: string | null
}

/**
 * A complete, self-contained `text/html` invoice document.
 *
 * No PDF library and no external asset: the browser's own print dialog produces
 * the PDF, which is what the HD Suite did and is the one part of it worth
 * keeping. Everything is inline so the page prints identically from the shop's
 * tablet and from a customer's phone with no network.
 *
 * COST AND MARGIN ARE NEVER RENDERED, whatever the view carries — this same
 * function backs both the internal print route and the public customer page.
 */
export function renderInvoiceHtml(view: InvoiceView, options: RenderOptions = {}): string {
  const { printButton = true, payPrompt = null } = options

  const laborRows = view.labor.map((item) => lineRow(item, 'hrs')).join('')
  const partRows = view.parts.map((item) => lineRow(item, 'ea')).join('')
  const emptyRow = '<tr><td colspan="4" class="muted">Nothing billed.</td></tr>'

  const statusBadge = view.paidAt
    ? '<span class="badge badge-paid">Paid</span>'
    : view.status === 'invoiced'
      ? '<span class="badge badge-due">Due</span>'
      : '<span class="badge badge-draft">Draft</span>'

  const partyBlock = (title: string, party: InvoiceParty, extra = ''): string => `
    <div class="box">
      <h3>${esc(title)}</h3>
      <p class="strong">${esc(party.name)}</p>
      ${party.lines.map((line) => `<p>${esc(line)}</p>`).join('')}
      ${party.phone ? `<p>${esc(party.phone)}</p>` : ''}
      ${party.email ? `<p>${esc(party.email)}</p>` : ''}
      ${extra}
    </div>`

  const vehicleBlock = `
    <div class="box">
      <h3>Vehicle</h3>
      <p class="strong">${esc(view.vehicle.label)}</p>
      ${view.vehicle.vin ? `<p class="muted">VIN ${esc(view.vehicle.vin)}</p>` : ''}
      ${view.vehicle.unitNumber ? `<p class="muted">Unit #${esc(view.vehicle.unitNumber)}</p>` : ''}
      ${
        view.vehicle.mileage !== null
          ? `<p class="muted">${esc(view.vehicle.mileage.toLocaleString('en-US'))} mi</p>`
          : ''
      }
    </div>`

  const complaintBlock = view.complaint || view.description
    ? `<div class="note">
         <h3>Work requested</h3>
         <p>${esc(view.complaint || view.description)}</p>
       </div>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(invoiceLabel(view))} - ${esc(view.shop.name)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; font-size: 13px;
         color: #0f172a; background: #f1f5f9; line-height: 1.5; }
  .page { background: #fff; max-width: 820px; margin: 24px auto; padding: 44px;
          border: 1px solid #e2e8f0; border-radius: 12px; }
  .head { display: flex; flex-wrap: wrap; gap: 20px; justify-content: space-between;
          align-items: flex-start; border-bottom: 3px solid #0f172a; padding-bottom: 18px; }
  .biz { font-size: 20px; font-weight: 800; letter-spacing: -0.01em; }
  .meta { text-align: right; }
  .meta .num { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
               font-size: 20px; font-weight: 800; }
  .meta p { font-size: 12px; color: #475569; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 20px; margin: 26px 0; }
  .box h3, .note h3 { font-size: 10px; font-weight: 800; letter-spacing: 0.09em;
                      text-transform: uppercase; color: #64748b; margin-bottom: 6px;
                      border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  .box p, .note p { font-size: 13px; }
  .strong { font-weight: 700; }
  .muted { color: #64748b; font-size: 12px; }
  .note { border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 8px;
          padding: 12px; margin-bottom: 20px; white-space: pre-wrap; }
  h2.sec { font-size: 10px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase;
           color: #64748b; margin: 22px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  thead tr { background: #0f172a; color: #fff; }
  thead th { padding: 8px 10px; text-align: left; font-size: 10px; font-weight: 700;
             letter-spacing: 0.06em; text-transform: uppercase; }
  thead th.num, td.num { text-align: right; }
  tbody td { padding: 9px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  td.num { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
           font-variant-numeric: tabular-nums; white-space: nowrap; }
  .totals { display: flex; justify-content: flex-end; margin-top: 22px; }
  .totals-box { width: 290px; }
  .trow { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; }
  .trow span:last-child { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
                          font-variant-numeric: tabular-nums; }
  .trow.rule { border-top: 1px solid #e2e8f0; margin-top: 4px; padding-top: 8px; }
  .trow.grand { border-top: 2px solid #0f172a; margin-top: 4px; padding-top: 9px;
                font-size: 17px; font-weight: 800; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 10px;
           font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; }
  .badge-paid { background: #dcfce7; color: #166534; }
  .badge-due { background: #fef3c7; color: #92400e; }
  .badge-draft { background: #e2e8f0; color: #334155; }
  .pay { margin-top: 26px; border: 1px solid #e2e8f0; background: #f8fafc;
         border-radius: 8px; padding: 14px; font-size: 13px; }
  .foot { margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 14px;
          text-align: center; font-size: 11px; color: #94a3b8; }
  .bar { text-align: center; margin: 20px auto 0; max-width: 820px; }
  .bar button { background: #0f172a; color: #fff; border: 0; padding: 11px 26px;
                border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; }
  @media print {
    body { background: #fff; }
    .page { margin: 0; padding: 0; border: 0; border-radius: 0; max-width: 100%; }
    .bar { display: none !important; }
  }
</style>
</head>
<body>
${printButton ? '<div class="bar"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>' : ''}
<div class="page">
  <div class="head">
    <div>
      <div class="biz">${esc(view.shop.name)}</div>
      ${view.shop.lines.map((line) => `<p class="muted">${esc(line)}</p>`).join('')}
      ${view.shop.phone ? `<p class="muted">${esc(view.shop.phone)}</p>` : ''}
      ${view.shop.email ? `<p class="muted">${esc(view.shop.email)}</p>` : ''}
    </div>
    <div class="meta">
      <div class="num">${esc(invoiceLabel(view))}</div>
      <p>Date: ${esc(formatInvoiceDate(view.invoiceDate))}</p>
      <p>Work order: #${esc(view.jobNumber)}</p>
      <p>${statusBadge}</p>
      ${view.paidAt ? `<p>Paid ${esc(formatInvoiceDate(view.paidAt))}</p>` : ''}
    </div>
  </div>

  <div class="grid">
    ${partyBlock('Bill to', view.customer)}
    ${vehicleBlock}
  </div>

  ${complaintBlock}

  <h2 class="sec">Labor</h2>
  <table>
    <thead><tr>
      <th style="width:52%">Description</th>
      <th class="num" style="width:14%">Hours</th>
      <th class="num" style="width:16%">Rate</th>
      <th class="num" style="width:18%">Amount</th>
    </tr></thead>
    <tbody>${laborRows || emptyRow}</tbody>
  </table>

  <h2 class="sec">Parts</h2>
  <table>
    <thead><tr>
      <th style="width:52%">Description</th>
      <th class="num" style="width:14%">Qty</th>
      <th class="num" style="width:16%">Price</th>
      <th class="num" style="width:18%">Amount</th>
    </tr></thead>
    <tbody>${partRows || emptyRow}</tbody>
  </table>

  <div class="totals">
    <div class="totals-box">
      ${totalsRow(`Labor (${view.totals.laborHours} hrs)`, money(view.totals.laborTotal))}
      ${totalsRow('Parts', money(view.totals.partsTotal))}
      ${totalsRow('Subtotal', money(view.totals.subtotal), 'rule')}
      ${totalsRow(
        `Sales tax on parts (${round2AsPercent(view.totals.taxRate)}%)`,
        money(view.totals.tax),
      )}
      ${totalsRow('Total', money(view.totals.total), 'grand')}
    </div>
  </div>

  ${payPrompt ? `<div class="pay">${esc(payPrompt)}</div>` : ''}

  <div class="foot">
    <p>${esc(view.shop.name)}${view.shop.phone ? ` &bull; ${esc(view.shop.phone)}` : ''}</p>
    <p>Thank you for your business.</p>
  </div>
</div>
</body>
</html>`
}

/**
 * Plain-text summary for the SMS body. Kept short — the public link is the
 * payload and every extra character is another segment on the 10DLC campaign.
 */
export function invoiceSmsBody(view: InvoiceView): string {
  const url = view.publicUrl
  const who = view.shop.name
  const amount = money(view.totals.total)
  const label = invoiceLabel(view)
  return url
    ? `${who}: invoice ${label} for ${amount} is ready. View it here: ${url}`
    : `${who}: invoice ${label} for ${amount} is ready. Reply here with any questions.`
}

/** Body HTML for the customer's invoice email, for `sendShopEmail`. */
export function invoiceEmailBody(view: InvoiceView): string {
  const rows = [
    ['Invoice', invoiceLabel(view)],
    ['Work order', `#${view.jobNumber}`],
    ['Vehicle', view.vehicle.label],
    ['Date', formatInvoiceDate(view.invoiceDate)],
    ['Total due', money(view.totals.total)],
  ]
    .map(
      ([label, value]) =>
        `<tr><td style="color:#64748b;padding:6px 0;width:130px;">${esc(label)}</td>` +
        `<td style="padding:6px 0;font-weight:600;">${esc(value)}</td></tr>`,
    )
    .join('')

  const button = view.publicUrl
    ? `<p style="margin:24px 0;">
         <a href="${esc(view.publicUrl)}"
            style="display:inline-block;background:#0f172a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">
           View your invoice
         </a>
       </p>`
    : ''

  return `
    <p>Your invoice from <strong>${esc(view.shop.name)}</strong> is ready.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>
    ${button}
    <p style="font-size:13px;color:#475569;">
      Questions about this invoice? Call ${esc(view.shop.phone ?? view.shop.name)}.
    </p>
  `
}

// QuickBooks export generators for NWI Shop invoices.
//
// An "invoice" in NWI Shop is a shop_jobs row that has reached status `invoiced`
// (dated by invoiced_at, voided = false). Its money lives entirely in
// shop_job_line_items; there is no stored total or tax column, so every figure in
// this file is derived from the line items plus the shop's tax rate.
//
// Two output formats, because QuickBooks ships two importers that share nothing:
//   - IIF: QuickBooks Desktop. Tab-separated, CRLF, journal-style TRNS/SPL groups.
//   - CSV: QuickBooks Online. One row per LINE ITEM, invoice header repeated.
//
// Everything here is a pure function: no Supabase, no Next, no request context, so
// the generators can be unit tested and called from either a route or a script.

import Papa from 'papaparse'
import type { LineItemType } from '@/lib/types'

// --- Input contract ---------------------------------------------------------

/** One shop_job_line_items row, narrowed to the fields the export needs. */
export interface ExportLineItem {
  id:          string
  type:        LineItemType
  description: string
  part_number: string | null
  quantity:    number
  unit_cost:   number
  unit_price:  number
  total:       number
}

/**
 * One invoice, already joined and flattened by the data layer: a shop_jobs row plus
 * its customer's display name, its vehicle's display label, and its line items.
 * This is the input contract for BOTH generators and for `summarize()`.
 */
export interface ExportInvoice {
  id:            string
  job_number:    number
  invoiced_at:   string | null
  created_at:    string
  description:   string | null
  customer_name: string | null
  vehicle_label: string | null
  line_items:    ExportLineItem[]
}

/** The slice of shop_profiles the generators need. */
export interface ExportShop {
  business_name: string
  /** Accepts either a fraction (0.07) or a percentage (7) - see `taxFraction`. */
  tax_rate:      number
}

// --- Primitives -------------------------------------------------------------

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// 2dp, no thousands separators, no currency symbol - QuickBooks parses these as raw
// numbers and chokes on "$1,234.00".
function money(v: unknown): string {
  return num(v).toFixed(2)
}

/**
 * IIF is TAB delimited with CRLF row breaks, so a tab, CR or LF inside ANY
 * interpolated value silently splits the row and shifts every field after it into
 * the wrong column - and QuickBooks imports the mangled result without complaining.
 * Every user-entered string (customer name, part description, job description,
 * business name) therefore goes through here before it lands in an IIF cell. Runs
 * are collapsed to a single space rather than deleted so words are not glued
 * together.
 */
export function sanitizeIif(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).replace(/[\t\r\n]+/g, ' ').trim()
}

/**
 * QuickBooks (both editions) rejects ISO dates - it wants MM/DD/YYYY.
 * invoiced_at is a UTC timestamp; it is sliced as a STRING rather than run through
 * `new Date()` so a machine in UTC-5 cannot shift a midnight-stamped invoice back
 * onto the previous day (and out of the requested range).
 */
export function toQbDate(value: string | null | undefined): string {
  if (!value) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return ''
  return `${m[2]}/${m[3]}/${m[1]}`
}

/** The date an invoice belongs to: invoiced_at when set, created_at as a fallback. */
export function invoiceDate(inv: ExportInvoice): string {
  return inv.invoiced_at ?? inv.created_at
}

/** DOCNUM / InvoiceNo. The job number IS the invoice number in NWI Shop. */
export function invoiceNo(inv: ExportInvoice): string {
  return String(inv.job_number)
}

export function customerOf(inv: ExportInvoice): string {
  const name = inv.customer_name?.trim()
  return name && name.length > 0 ? name : 'Unknown Customer'
}

/**
 * shop_profiles.tax_rate is a bare number with no documented unit. Anything above 1
 * is read as a percentage (7 becomes 0.07); anything at or below 1 is already a
 * fraction. A 100%+ sales tax does not exist, so the ambiguity is safe to resolve
 * this way.
 */
export function taxFraction(shop: ExportShop): number {
  const rate = num(shop.tax_rate)
  if (rate <= 0) return 0
  return rate > 1 ? rate / 100 : rate
}

// --- Totals -----------------------------------------------------------------

export interface InvoiceTotals {
  labor:     number
  parts:     number
  /** What the parts cost the shop (quantity x unit_cost) - manager-only figure. */
  partsCost: number
  subtotal:  number
  tax:       number
  total:     number
}

/**
 * Money for one invoice.
 *
 * TAX POLICY: the shop's tax rate is applied to PARTS ONLY. Automotive labor is
 * untaxed in most states and shop_jobs carries no per-invoice tax column to defer
 * to, so the rule lives here in one place - change this single expression if a shop
 * needs labor taxed too, and every summary, IIF and CSV follows.
 */
export function invoiceTotals(inv: ExportInvoice, shop: ExportShop): InvoiceTotals {
  let labor     = 0
  let parts     = 0
  let partsCost = 0

  for (const li of inv.line_items ?? []) {
    const total = num(li.total)
    if (li.type === 'labor') {
      labor += total
    } else {
      parts     += total
      partsCost += num(li.quantity) * num(li.unit_cost)
    }
  }

  const subtotal = round2(labor + parts)
  const tax      = round2(parts * taxFraction(shop))

  return {
    labor:     round2(labor),
    parts:     round2(parts),
    partsCost: round2(partsCost),
    subtotal,
    tax,
    total:     round2(subtotal + tax),
  }
}

export interface FinancialSummary {
  invoiceCount:  number
  /** Pre-tax earned revenue. Sales tax is collected for the state, not earned. */
  revenue:       number
  laborRevenue:  number
  partsRevenue:  number
  partsCost:     number
  grossMargin:   number
  marginPct:     number
  taxCollected:  number
  /** Revenue + tax: what was billed, and what the export files total to. */
  totalInvoiced: number
  avgInvoice:    number
}

/**
 * Roll a set of invoices into the page/API summary.
 *
 * Gross margin here is revenue minus PART cost only. Labor cost is payroll and
 * lives in the timeclock module; folding an estimate of it in here would make this
 * number disagree with the payroll report.
 */
export function summarize(invoices: ExportInvoice[], shop: ExportShop): FinancialSummary {
  let laborRevenue = 0
  let partsRevenue = 0
  let partsCost    = 0
  let taxCollected = 0

  for (const inv of invoices) {
    const t = invoiceTotals(inv, shop)
    laborRevenue += t.labor
    partsRevenue += t.parts
    partsCost    += t.partsCost
    taxCollected += t.tax
  }

  const revenue       = round2(laborRevenue + partsRevenue)
  const grossMargin   = round2(revenue - partsCost)
  const totalInvoiced = round2(revenue + taxCollected)
  const count         = invoices.length

  return {
    invoiceCount:  count,
    revenue,
    laborRevenue:  round2(laborRevenue),
    partsRevenue:  round2(partsRevenue),
    partsCost:     round2(partsCost),
    grossMargin,
    marginPct:     revenue > 0 ? round2((grossMargin / revenue) * 100) : 0,
    taxCollected:  round2(taxCollected),
    totalInvoiced,
    avgInvoice:    count > 0 ? round2(totalInvoiced / count) : 0,
  }
}

// --- Split building (shared by both formats) --------------------------------

interface QbSplit {
  account:     string
  description: string
  item:        string
  quantity:    number
  amount:      number
}

const ACCT_AR  = 'Accounts Receivable'
const ACCT_INC = 'Services'
const ACCT_TAX = 'Sales Tax Payable'

/** Every income component of one invoice, in the order it should appear. */
function buildSplits(inv: ExportInvoice, shop: ExportShop): QbSplit[] {
  const splits: QbSplit[] = []
  const totals = invoiceTotals(inv, shop)

  for (const li of inv.line_items ?? []) {
    const amount = num(li.total)
    if (amount === 0) continue
    const label = li.type === 'part' && li.part_number
      ? `${li.description || 'Part'} (${li.part_number})`
      : (li.description || (li.type === 'labor' ? 'Labor' : 'Parts'))
    const qty = num(li.quantity)
    splits.push({
      account:     ACCT_INC,
      description: label,
      item:        li.type === 'part' ? 'Parts' : 'Labor',
      quantity:    qty > 0 ? qty : 1,
      amount,
    })
  }

  // An invoice with a total but no usable line items would otherwise export as a
  // TRNS with nothing behind it. Fall back to one service line for the pre-tax
  // amount so the transaction still balances.
  if (splits.length === 0 && totals.subtotal !== 0) {
    splits.push({
      account:     ACCT_INC,
      description: inv.description?.trim() || 'Shop service',
      item:        'Labor',
      quantity:    1,
      amount:      totals.subtotal,
    })
  }

  if (totals.tax > 0) {
    splits.push({
      account:     ACCT_TAX,
      description: 'Sales Tax',
      item:        'Sales Tax',
      quantity:    1,
      amount:      totals.tax,
    })
  }

  // Line-item rounding can leave the splits a cent off the invoice total.
  // QuickBooks rejects - or worse, silently mangles - an unbalanced transaction, so
  // any residual is pushed into a visible adjusting line instead of breaking the
  // import.
  const summed   = splits.reduce((s, sp) => s + sp.amount, 0)
  const residual = round2(totals.total - summed)
  if (Math.abs(residual) >= 0.01) {
    splits.push({
      account:     ACCT_INC,
      description: 'Rounding / adjustment',
      item:        'Adjustment',
      quantity:    1,
      amount:      residual,
    })
  }

  return splits
}

// --- IIF (QuickBooks Desktop) -----------------------------------------------

const TAB  = '\t'
const CRLF = '\r\n'

const IIF_HEADER = [
  ['!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'DOCNUM', 'MEMO'].join(TAB),
  ['!SPL',  'SPLID',  'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'DOCNUM', 'MEMO'].join(TAB),
  '!ENDTRNS',
]

/**
 * Build a QuickBooks Desktop .IIF file. Import with File > Utilities > Import.
 *
 * Format rules that are not negotiable:
 *   - Fields are TAB separated, never commas.
 *   - Lines end with CRLF; QuickBooks' parser treats a bare LF as a malformed file.
 *   - One header block for the whole file, then a TRNS / SPL... / ENDTRNS group per
 *     invoice.
 *
 * SIGN CONVENTION - the reason a bad IIF imports as junk rather than failing loudly:
 * IIF is double-entry. The TRNS line is the DEBIT to Accounts Receivable and carries
 * the POSITIVE invoice total. Every SPL is the matching CREDIT to income / sales tax
 * and is therefore NEGATIVE. TRNS + all SPLs must sum to exactly zero per
 * transaction.
 */
export function buildIif(invoices: ExportInvoice[], shop: ExportShop): string {
  const memoTag = sanitizeIif(shop.business_name?.trim() || 'NWI Shop')
  const lines: string[] = [...IIF_HEADER]

  for (const inv of invoices) {
    const date     = toQbDate(invoiceDate(inv))
    const customer = sanitizeIif(customerOf(inv))
    const docNum   = sanitizeIif(invoiceNo(inv))
    const splits   = buildSplits(inv, shop)
    const total    = splits.reduce((s, sp) => s + sp.amount, 0)

    // A job invoiced with no line items at all produces no splits, and a TRNS with
    // nothing behind it is an invalid transaction that can fail the ENTIRE import -
    // one junk row would cost the whole quarter. It is skipped instead; it carries
    // $0, so no money goes missing, and the QBO CSV drops it for the same reason.
    if (splits.length === 0) continue

    lines.push([
      'TRNS',
      '',              // TRNSID - blank lets QuickBooks assign it
      'INVOICE',
      date,
      ACCT_AR,
      customer,
      '',              // CLASS - unused
      money(total),    // POSITIVE: debit A/R
      docNum,
      sanitizeIif(`${memoTag} invoice ${docNum}`),
    ].join(TAB))

    for (const sp of splits) {
      lines.push([
        'SPL',
        '',                    // SPLID - blank lets QuickBooks assign it
        'INVOICE',
        date,
        sanitizeIif(sp.account),
        customer,
        '',                    // CLASS - unused
        money(-sp.amount),     // NEGATIVE: credit income / sales tax
        '',                    // DOCNUM lives on the TRNS line only
        sanitizeIif(sp.description),
      ].join(TAB))
    }

    lines.push('ENDTRNS')
  }

  return lines.join(CRLF) + CRLF
}

// --- CSV (QuickBooks Online) ------------------------------------------------

const CSV_COLUMNS = [
  'InvoiceNo',
  'Customer',
  'InvoiceDate',
  'DueDate',
  'Terms',
  'Item(Product/Service)',
  'ItemDescription',
  'ItemQuantity',
  'ItemRate',
  'ItemAmount',
  'Taxable',
  'TaxAmount',
] as const

type CsvRow = Record<(typeof CSV_COLUMNS)[number], string>

/**
 * Build a QuickBooks Online invoice-import CSV.
 * Import with Settings > Import Data > Invoices.
 *
 * QBO's importer is row-per-line-item: the invoice header columns repeat on every
 * row and rows sharing an InvoiceNo are collapsed back into one invoice on import.
 * Generated through papaparse so quoting and escaping are never hand-rolled.
 */
export function buildQboCsv(invoices: ExportInvoice[], shop: ExportShop): string {
  const rows: CsvRow[] = []

  for (const inv of invoices) {
    const docNum   = invoiceNo(inv)
    const customer = customerOf(inv)
    const date     = toQbDate(invoiceDate(inv))
    const tax      = invoiceTotals(inv, shop).tax

    // In QBO sales tax is a QuickBooks-side calculation, so the tax split is not
    // emitted as a line - it rides in the TaxAmount column instead.
    const splits = buildSplits(inv, shop).filter(sp => sp.account !== ACCT_TAX)

    splits.forEach((sp, i) => {
      const qty  = sp.quantity || 1
      const rate = sp.amount / qty
      rows.push({
        InvoiceNo:               docNum,
        Customer:                customer,
        InvoiceDate:             date,
        // shop_jobs has no terms or due date: an invoiced job is due on receipt.
        DueDate:                 date,
        Terms:                   'Due on receipt',
        'Item(Product/Service)': sp.item,
        ItemDescription:         sp.description,
        ItemQuantity:            qty % 1 === 0 ? String(qty) : qty.toFixed(2),
        ItemRate:                money(rate),
        ItemAmount:              money(sp.amount),
        Taxable:                 tax > 0 ? 'Y' : 'N',
        // Tax is an invoice-level figure. Repeating it on every row would multiply
        // it by the line count on import, so it only lands on the first row.
        TaxAmount:               i === 0 ? money(tax) : money(0),
      })
    })
  }

  return Papa.unparse(rows, { columns: [...CSV_COLUMNS], newline: CRLF }) + CRLF
}

// --- Range helpers ----------------------------------------------------------

export type RangePreset = 'ytd' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom'

export const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'ytd',    label: 'Year to date' },
  { key: 'q1',     label: 'Q1' },
  { key: 'q2',     label: 'Q2' },
  { key: 'q3',     label: 'Q3' },
  { key: 'q4',     label: 'Q4' },
  { key: 'custom', label: 'Custom' },
]

export interface DateRange {
  /** Inclusive start, YYYY-MM-DD. */
  from:  string
  /** Inclusive end, YYYY-MM-DD. */
  to:    string
  label: string
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

export function isYmd(v: unknown): v is string {
  return typeof v === 'string' && YMD_RE.test(v)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local calendar date as YYYY-MM-DD (never `toISOString`, which shifts by offset). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * The day AFTER `date`, as YYYY-MM-DD. Ranges are queried as
 * [from 00:00Z, nextDay 00:00Z) rather than `lte to`, so an invoice stamped later
 * in the day on the final date is not truncated off the end of the range.
 */
export function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`
}

/** Calendar quarters - MM-DD bounds, applied to whichever year is selected. */
const QUARTERS: Record<'q1' | 'q2' | 'q3' | 'q4', [string, string]> = {
  q1: ['01-01', '03-31'],
  q2: ['04-01', '06-30'],
  q3: ['07-01', '09-30'],
  q4: ['10-01', '12-31'],
}

export function isRangePreset(v: unknown): v is RangePreset {
  return typeof v === 'string' && RANGE_PRESETS.some(p => p.key === v)
}

/**
 * Resolve a preset + year (+ custom dates) to a concrete inclusive range.
 * YTD stops at today for the current year and at Dec 31 for any past year.
 * Reversed custom dates are swapped rather than rejected.
 */
export function rangeFor(
  preset: RangePreset,
  year: number,
  custom?: { from?: string | null; to?: string | null },
): DateRange {
  const now   = new Date()
  const today = ymd(now)

  if (preset === 'custom') {
    const rawFrom = isYmd(custom?.from) ? custom.from : `${year}-01-01`
    const rawTo   = isYmd(custom?.to)   ? custom.to   : today
    const from    = rawFrom <= rawTo ? rawFrom : rawTo
    const to      = rawFrom <= rawTo ? rawTo   : rawFrom
    return { from, to, label: `${from} to ${to}` }
  }

  if (preset === 'ytd') {
    const to = year === now.getFullYear() ? today : `${year}-12-31`
    return { from: `${year}-01-01`, to, label: `Year to date ${year}` }
  }

  const [start, end] = QUARTERS[preset]
  return {
    from:  `${year}-${start}`,
    to:    `${year}-${end}`,
    label: `${preset.toUpperCase()} ${year}`,
  }
}

/** Filename-safe slug for the range, used in the download filenames. */
export function rangeSlug(range: DateRange): string {
  return `${range.from}-to-${range.to}`
}

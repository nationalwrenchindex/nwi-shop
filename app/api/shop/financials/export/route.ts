// GET /api/shop/financials/export?format=iif|csv&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns the QuickBooks file itself as an attachment. The generators are pure and
// live in @/lib/shop/quickbooks; this route is only auth + fetch + headers.
//
// The file is built on the SERVER rather than in the browser so the export and the
// on-screen totals come from one query with one set of filters (status = invoiced,
// voided = false, shop-scoped) and cannot drift apart.

import { apiContext } from '@/lib/auth'
import { fetchInvoices } from '@/app/shop/(app)/financials/_data'
import { buildIif, buildQboCsv, isYmd } from '@/lib/shop/quickbooks'

export async function GET(request: Request): Promise<Response> {
  const auth = await apiContext('viewFinancials')
  if (!auth.ctx) return auth.error
  const { shop } = auth.ctx

  const params = new URL(request.url).searchParams
  const format = params.get('format') ?? 'iif'
  const from   = params.get('from')
  const to     = params.get('to')

  if (format !== 'iif' && format !== 'csv') {
    return Response.json({ error: 'format must be iif or csv' }, { status: 400 })
  }
  if (!isYmd(from) || !isYmd(to)) {
    return Response.json({ error: 'from and to must be YYYY-MM-DD' }, { status: 400 })
  }
  if (from > to) {
    return Response.json({ error: 'from must not be after to' }, { status: 400 })
  }

  const { invoices, error } = await fetchInvoices(shop.id, from, to)
  if (error) return Response.json({ error }, { status: 500 })

  const filename = `nwi-shop-invoices-${from}-to-${to}.${format}`

  // A UTF-8 BOM goes on the CSV so Excel and QuickBooks Online read accented
  // customer names correctly. It is deliberately NOT written to the IIF: QuickBooks
  // Desktop matches the first row literally against "!TRNS", and a leading BOM turns
  // that into an unrecognised keyword and fails the whole import.
  const body = format === 'csv'
    ? '﻿' + buildQboCsv(invoices, shop)
    : buildIif(invoices, shop)

  const contentType = format === 'csv'
    ? 'text/csv; charset=utf-8'
    : 'application/octet-stream'

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type':        contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'no-store',
    },
  })
}

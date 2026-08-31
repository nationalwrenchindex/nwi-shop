// GET /api/shop/financials/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// The numbers behind the financials page, and the live "N invoices - $X" preview
// the QuickBooks export block shows before you download anything. Manager only.

import { apiContext } from '@/lib/auth'
import { fetchInvoices } from '@/app/shop/(app)/financials/_data'
import { isYmd, summarize } from '@/lib/shop/quickbooks'

export async function GET(request: Request): Promise<Response> {
  const auth = await apiContext('viewFinancials')
  if (!auth.ctx) return auth.error
  const { shop } = auth.ctx

  const params = new URL(request.url).searchParams
  const from   = params.get('from')
  const to     = params.get('to')

  if (!isYmd(from) || !isYmd(to)) {
    return Response.json({ error: 'from and to must be YYYY-MM-DD' }, { status: 400 })
  }
  if (from > to) {
    return Response.json({ error: 'from must not be after to' }, { status: 400 })
  }

  // Scoped to the caller's own shop_id - never a shop id from the query string.
  const { invoices, error } = await fetchInvoices(shop.id, from, to)
  if (error) return Response.json({ error }, { status: 500 })

  return Response.json({ from, to, ...summarize(invoices, shop) })
}

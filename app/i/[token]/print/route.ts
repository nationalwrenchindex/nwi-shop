// GET /i/[token]/print - the printable copy of a customer's own invoice.
//
// Same token, same loader, same customer-safe view as the page beside it, so
// there is no way for the printed copy and the web copy to disagree - and no
// second place where cost could leak in. `renderInvoiceHtml` never emits cost or
// margin, and `loadPublicInvoice` never puts them on the view in the first place.
//
// Public by design (a customer has no login), so this route sits under /i and
// must be reachable without a session - see the proxy note in page.tsx.

import type { NextRequest } from 'next/server'
import { renderInvoiceHtml } from '@/lib/shop/invoice'
import { loadPublicInvoice, payPrompt } from '../_data'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ token: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params
  const result = await loadPublicInvoice(token)
  if (!result) return new Response('Not found', { status: 404 })

  const html = renderInvoiceHtml(result.view, {
    printButton: true,
    payPrompt:   payPrompt(result.contact, !!result.view.paidAt),
  })

  return new Response(html, {
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // A capability URL must never be indexed.
      'X-Robots-Tag':  'noindex, nofollow',
    },
  })
}

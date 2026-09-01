// GET /api/shop/jobs/[id]/invoice/print - the printable invoice document.
//
// Returns a complete, self-contained `text/html` page with inline `@media print`
// rules and a Print / Save as PDF button. There is deliberately NO PDF library:
// the browser's own print pipeline produces a better PDF than a headless
// renderer would, it costs zero dependencies and zero cold-start, and it prints
// the same from the shop tablet and from a phone.
//
// The renderer never emits cost or margin, whatever the caller may see
// elsewhere — this same function backs the public customer page.

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { loadJobDetail } from '@/lib/shop/jobs'
import { buildInvoice, renderInvoiceHtml } from '@/lib/shop/invoice'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext('viewAllJobs')
  if (error) return error

  const { id } = await params
  const supabase = await createClient()

  const detail = await loadJobDetail(supabase, id, { shopId: ctx.shop.id, techId: null })
  if (!detail) return new Response('Not found', { status: 404 })

  // `withMargins` is left false on purpose. This document is handed to the
  // customer; there is no version of it that carries cost.
  const view = buildInvoice(
    detail.job,
    detail.lineItems,
    detail.customer,
    detail.vehicle,
    ctx.shop,
    false,
  )

  return new Response(renderInvoiceHtml(view, { printButton: true }), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

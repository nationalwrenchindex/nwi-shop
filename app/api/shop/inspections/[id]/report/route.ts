// GET /api/shop/inspections/[id]/report — the printable inspection certificate.
//
// text/html, not a PDF binary: a self-contained document with inline @media print
// rules and a print button, which the browser turns into a PDF. NWI Suite
// generates its DOT certificate the same way and it is the right call — no PDF
// library, no font embedding, and one rendering path instead of two that drift.
//
// Read scope is the caller's own shop, enforced by RLS on the select plus the
// explicit shop_id filter in loadInspection(). The feature gate is applied to the
// row's own `type`, so an LD shop that somehow held a link to an HD document
// still cannot open it.

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { canUseInspectionType, inspectionFeatureMessage } from '@/lib/shop/inspections/access'
import { loadInspection } from '@/lib/shop/inspections/query'
import { renderInspectionReport } from '@/lib/shop/inspections/report'
import { formFor } from '@/lib/shop/inspections/result'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext()
  if (error) return error

  const { id } = await params
  const supabase = await createClient()

  const { inspection, context, warning } = await loadInspection(
    supabase,
    ctx.shop.id,
    id,
    ctx.shop.business_name,
  )

  if (warning) return new Response(warning, { status: 503 })
  if (!inspection) return new Response('Inspection not found.', { status: 404 })

  if (!canUseInspectionType(ctx, inspection.type)) {
    return new Response(inspectionFeatureMessage(ctx, inspection.type), { status: 403 })
  }

  const def = formFor(inspection.type, inspection.cadence)
  if (!def) {
    return new Response('This inspection was filed against a form that no longer exists.', {
      status: 409,
    })
  }

  return new Response(renderInspectionReport(inspection, def, context), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // A signed record never changes, but it is also not something to leave in
      // a shared browser cache on a shop tablet.
      'Cache-Control': 'private, no-store',
    },
  })
}

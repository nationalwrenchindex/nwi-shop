// GET /api/shop/inspections/[id] — one inspection, with the labels the detail
// view needs resolved alongside it.
//
// THERE IS NO PUT, PATCH OR DELETE HERE, DELIBERATELY.
//
// A filed inspection is a signed compliance document. It is the evidence that a
// qualified person looked at a specific unit on a specific date and put their
// name to the result — 49 CFR 396.17 for DOT, OSHA 1926.453 for aerial. A record
// that can be edited after signing is not evidence of anything, and an edit
// endpoint would make `locked` a decoration. The correction path for a mistaken
// inspection is a new inspection, which is also how it works on paper.
//
// Migration 009 makes the same point from the other side: RLS still permits an
// UPDATE because a policy cannot express "no longer editable" without also
// blocking every correction, so respecting `locked` is application-layer work.
// This file is where that work happens — by not existing as a write path.

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/shop/jobs'
import { canUseInspectionType, inspectionFeatureMessage } from '@/lib/shop/inspections/access'
import { loadInspection } from '@/lib/shop/inspections/query'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext()
  if (error) return error

  const { id } = await params
  const supabase = await createClient()

  const loaded = await loadInspection(supabase, ctx.shop.id, id)
  if (loaded.warning) return apiError(loaded.warning, 503)
  if (!loaded.inspection) return apiError('Inspection not found.', 404)

  if (!canUseInspectionType(ctx, loaded.inspection.type)) {
    return apiError(inspectionFeatureMessage(ctx, loaded.inspection.type), 403)
  }

  return Response.json({ inspection: loaded.inspection, context: loaded.context })
}

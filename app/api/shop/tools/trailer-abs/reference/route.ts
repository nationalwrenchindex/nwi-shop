// GET /api/shop/tools/trailer-abs/reference
//
// Trailer brake / ABS / electrical reference lookup. NO AI ANYWHERE IN THIS ROUTE —
// it reads the shared hd_trailer_reference catalog and returns rows. It works exactly
// the same whether or not GEMINI_API_KEY is set, which is the point: when the AI half of
// the tool is unavailable, the specs a tech is actually under the trailer to look up
// still come back.
//
// Query params (all optional):
//   category  one of air_brakes | slack_adjusters | abs | wiring. Each maps to one or
//             more stored TrailerSystem values — see @/lib/shop/trailer/reference.
//             An unrecognised value is a 400 rather than a silent empty list.
//   q         free text, matched case-insensitively against system, component and
//             description. Omit to return everything in the category.
//   limit     1-1000. Omit for the whole (small) table, which is what the browser wants.
//
// Response: { entries, categories, source, available }
//   source     'live' when the rows came from the shared catalog, 'bundled' when that
//              table is not provisioned in this project and the ported rows were served
//              instead. The UI says which; it never pretends bundled rows are live.
//   available  false only when the shared catalog table does not exist.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import {
  CATEGORY_LABELS,
  REFERENCE_CATEGORIES,
  isReferenceCategory,
  lookupTrailerReference,
  type ReferenceCategory,
} from '@/lib/shop/trailer/reference'

export async function GET(req: NextRequest) {
  const { error } = await apiFeature('trailer_abs')
  if (error) return error

  const { searchParams } = new URL(req.url)
  const categoryParam = searchParams.get('category')?.trim() ?? ''
  const q             = searchParams.get('q')?.trim() ?? ''
  const limitText     = searchParams.get('limit')?.trim() ?? ''

  if (categoryParam && !isReferenceCategory(categoryParam)) {
    return Response.json(
      { error: `Unknown category. Expected one of: ${REFERENCE_CATEGORIES.join(', ')}` },
      { status: 400 },
    )
  }
  const category: ReferenceCategory | null = isReferenceCategory(categoryParam)
    ? categoryParam
    : null

  let limit: number | null = null
  if (limitText) {
    const parsed = Number(limitText)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
      return Response.json(
        { error: 'limit must be an integer between 1 and 1000' },
        { status: 400 },
      )
    }
    limit = parsed
  }

  try {
    const result = await lookupTrailerReference(category, q, limit)

    return Response.json({
      entries:    result.entries,
      categories: REFERENCE_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] })),
      source:     result.source,
      available:  result.available,
    })
  } catch (err) {
    console.error('[shop/trailer-abs] reference lookup failed', err)
    return Response.json({ error: 'Could not read the trailer reference.' }, { status: 500 })
  }
}

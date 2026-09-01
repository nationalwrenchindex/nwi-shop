// GET /api/shop/tools/parts-reference — OEM cross-reference lookup.
//
// Gated by apiFeature('parts_reference'): every shop type, Pro tier or better.
// Read-only over the shared hd_parts_reference / hd_parts / hd_parts_cross_ref
// catalogs — this route never writes to them.
//
// QUERY
//   ?q=11-9959          part number or free text (exact number ranks first)
//   ?manufacturer=TK    filter; "Both" rows always survive a manufacturer filter
//   ?category=Filters   filter
//   ?limit=60           1-300, default 60
//
// RESPONSE 200
//   {
//     results: [{
//       key:            string          // stable within this result set
//       oemPartNumber:  string | null
//       description:    string
//       manufacturer:   string | null
//       category:       string | null
//       unitFamily:     string | null
//       supersededBy:   string | null
//       notes:          string | null
//       fieldCritical:  boolean
//       crossRefs:      [{ brand, part, notes }]
//       source:         "reference" | "catalog"
//     }],
//     total: number, manufacturers: string[], categories: string[],
//     degraded: boolean
//   }
//
// ERRORS  401 unauthenticated · 403 { error } tier too low.

import { apiFeature } from '@/lib/auth'
import { searchParts } from '@/lib/shop/parts-reference'

export async function GET(request: Request) {
  const { error } = await apiFeature('parts_reference')
  if (error) return error

  const params = new URL(request.url).searchParams
  const limit = Number(params.get('limit'))

  const result = await searchParts({
    q:            params.get('q'),
    manufacturer: params.get('manufacturer'),
    category:     params.get('category'),
    limit:        Number.isFinite(limit) && limit > 0 ? limit : undefined,
  })

  return Response.json(result)
}

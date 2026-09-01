// GET /api/shop/tools/quickwrench-hd/parts
//
//   ?manufacturer=Thermo%20King&category=belt&unitModel=S-600&search=alternator
//   ?bm=BM123&bmManufacturer=TK        → build-number decode
//
// Reads NWI Suite's global HD catalogs (hd_parts, hd_parts_cross_ref,
// hd_bm_map). READ ONLY — this route never writes to an hd_* table. No model
// call, so it works with no AI key. Every query degrades to an empty list on
// error rather than failing the request.
//
// Model scoping is deliberate: pass `unitModel` and you get only parts whose
// unit_models array contains that exact model. The wrong belt for the wrong unit
// is a worse outcome than an empty list.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  lookupBuildNumber,
  lookupCrossRefs,
  lookupParts,
} from '@/lib/shop/quickwrench/hd-reference'

export async function GET(req: NextRequest) {
  const { error } = await apiFeature('quickwrench_hd')
  if (error) return error

  const params = req.nextUrl.searchParams
  const supabase = await createClient()

  const bm = params.get('bm')?.trim()
  if (bm) {
    const build = await lookupBuildNumber(
      supabase,
      bm,
      params.get('bmManufacturer')?.trim() || undefined,
    )
    return Response.json({ build, parts: [], crossRefs: [] })
  }

  const parts = await lookupParts(supabase, {
    manufacturer: params.get('manufacturer')?.trim() || undefined,
    category:     params.get('category')?.trim() || undefined,
    unitModel:    params.get('unitModel')?.trim() || undefined,
    search:       params.get('search')?.trim() || undefined,
    limit:        Number.parseInt(params.get('limit') ?? '', 10) || undefined,
  })

  const crossRefs = parts.length > 0
    ? await lookupCrossRefs(supabase, parts.map((p) => p.part_number))
    : []

  return Response.json({
    build: null,
    parts,
    crossRefs,
    note: 'Part numbers are reference only. Verify fitment against the OEM catalog before ordering, and always order the current replacement for a superseded number.',
  })
}

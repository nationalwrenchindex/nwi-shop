// SERVER ONLY. Read-only access to NWI Suite's shared diagnostic cache.
//
// WHY THIS IS READ-ONLY AND FAIL-OPEN
// -----------------------------------
// `hd_cached_diagnostics` belongs to NWI Suite, which shares this Supabase
// project. NWI Shop must never write to an `hd_*` table, so there is no upsert
// here and no `increment_hd_cache_hit` RPC call — the Suite owns both.
//
// The Suite's LD routes filter that table with `.eq('suite', 'ld')`, but the
// migration that would add a `suite` column could not be found in this project.
// So the column may not exist, the table may not exist, or RLS may refuse the
// select — and any of those makes the query error. Treat the cache as strictly
// optional: on ANY failure we return null and the caller does a live Gemini
// call. A cache miss is slower; a crash is a tech standing at a vehicle with a
// broken tool.
//
// The one thing we do NOT do is fall back to an unfiltered read. HD entries in
// that table are heavy-duty answers; serving one for a light-duty vehicle would
// be worse than no cache at all.

import { createClient } from '@/lib/supabase/server'
import { normalizeDiagnostic, type LdDiagnostic } from './ld'

interface CachedRow {
  result_html: string | null
  citations:   unknown
}

function asCitations(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((c): c is string => typeof c === 'string' && c.length > 0)
    : []
}

/**
 * Returns a cached diagnostic, or null when there is no usable entry — which
 * includes every error path. Never throws.
 */
export async function readCachedDiagnostic(cacheKey: string): Promise<LdDiagnostic | null> {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('hd_cached_diagnostics')
      .select('result_html, citations')
      .eq('cache_key', cacheKey)
      .eq('suite', 'ld')
      .maybeSingle<CachedRow>()

    // `error` here is expected on a deployment without the `suite` column.
    // Log once at debug volume and move on to the live call.
    if (error) {
      console.warn('[quickwrench-ld] cache read unavailable, using live diagnosis:', error.message)
      return null
    }
    if (!data?.result_html) return null

    // Legacy Suite entries stored plain text rather than JSON; those do not
    // parse and simply become a miss.
    const parsed = normalizeDiagnostic(JSON.parse(data.result_html), asCitations(data.citations))
    return parsed.name ? parsed : null
  } catch {
    return null
  }
}

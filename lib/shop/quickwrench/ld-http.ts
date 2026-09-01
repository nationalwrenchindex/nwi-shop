// Small route-handler helpers shared by every QuickWrench LD API route. Kept
// local to this tool so the engine does not couple to another build area's
// helper module.

/** Uniform error envelope: `{ error }`, matching the rest of the shop API. */
export function ldError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

/** Parses a JSON object body. Returns null for anything that is not an object. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await req.json()
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Trimmed string, or '' for anything else. */
export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Pulls year/make/model from a query string and reports which are missing, so
 * the NHTSA routes give the same 400 message.
 */
export function readVehicleQuery(
  params: URLSearchParams,
): { make: string; model: string; year: string } | null {
  const make  = text(params.get('make'))
  const model = text(params.get('model'))
  const year  = text(params.get('year'))
  return make && model && year ? { make, model, year } : null
}

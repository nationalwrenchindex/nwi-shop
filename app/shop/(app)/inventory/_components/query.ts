/** URL helpers shared by the inventory filter controls. Filters live in the
 *  query string so the server component can do the filtering. */

export type QueryState = Record<string, string | undefined>

export function withParams(current: QueryState, patch: Record<string, string | null>): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(current)) {
    if (value) params.set(key, value)
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') params.delete(key)
    else params.set(key, value)
  }

  const qs = params.toString()
  return qs ? `/shop/inventory?${qs}` : '/shop/inventory'
}

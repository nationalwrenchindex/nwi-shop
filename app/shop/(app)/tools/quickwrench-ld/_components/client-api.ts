// Browser-side fetch wrappers for the QuickWrench LD routes.
//
// Every call resolves — never rejects — so a panel can always render a message
// instead of a blank card. A tech is standing at a vehicle; "the lookup failed"
// is information, an empty panel is not.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

function messageFrom(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const value = (payload as { error: unknown }).error
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return fallback
}

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    return { ok: false, error: 'Network error — the request never reached the server.' }
  }

  const payload: unknown = await res.json().catch(() => null)

  if (!res.ok) {
    return { ok: false, error: messageFrom(payload, `Request failed (${res.status}).`) }
  }
  if (payload === null) {
    return { ok: false, error: 'The server returned an unreadable response.' }
  }
  return { ok: true, data: payload as T }
}

export function getJson<T>(url: string): Promise<ApiResult<T>> {
  return request<T>(url)
}

export function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  return request<T>(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

export function patchJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  return request<T>(url, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

/** Base path for every QuickWrench LD route, in one place. */
export const LD_API = '/api/shop/tools/quickwrench-ld'

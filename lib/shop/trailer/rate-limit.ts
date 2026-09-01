// SERVER-ONLY. Per-shop request throttle for the trailer ABS diagnostic.
//
// HONEST LIMITATION — READ THIS BEFORE RELYING ON IT: the window lives in a Map in this
// process. On serverless that is per-instance, not per-shop-globally. Each warm instance
// keeps its own Map, so a shop spread across N concurrent instances gets roughly N times
// the limit, and every cold start resets the window to empty.
//
// It is therefore a COST GUARDRAIL — it stops a stuck retry loop or an impatient
// double-tap from firing a dozen 55-second model calls — and it is NOT a security
// control. Do not present it as one, and do not build anything on top of it that assumes
// a hard ceiling. A real limit, one a determined caller cannot walk around by forcing new
// instances, has to live in shared state: Postgres or Redis.
//
// Keyed on the SHOP, not the user: the cost being guarded is the shop's, and a shop with
// six techs hammering the same button is exactly the case worth damping.

const RATE_LIMIT_MAX       = 10
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_SWEEP_AT  = 5_000   // entries, before an opportunistic prune

const hitsByShop = new Map<string, number[]>()

export interface RateLimitVerdict {
  allowed:       boolean
  retryAfterSec: number
}

export function checkTrailerAbsRateLimit(shopId: string): RateLimitVerdict {
  const now    = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS

  // The Map only ever grows otherwise — a long-lived instance would accumulate one entry
  // per shop that ever called. Sweeping only when it gets large keeps the common path
  // O(1) instead of walking every shop on every request.
  if (hitsByShop.size > RATE_LIMIT_SWEEP_AT) {
    for (const [key, stamps] of hitsByShop) {
      if (stamps.every((t) => t <= cutoff)) hitsByShop.delete(key)
    }
  }

  const hits = (hitsByShop.get(shopId) ?? []).filter((t) => t > cutoff)

  if (hits.length >= RATE_LIMIT_MAX) {
    hitsByShop.set(shopId, hits)
    const oldest = hits[0] ?? now
    return {
      allowed:       false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000)),
    }
  }

  hits.push(now)
  hitsByShop.set(shopId, hits)
  return { allowed: true, retryAfterSec: 0 }
}

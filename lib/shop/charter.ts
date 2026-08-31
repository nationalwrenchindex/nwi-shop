// The Charter Member program: the first 50 shops to subscribe keep their launch
// price forever. Nothing in this file may ever raise a charter member's price.

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

/** Total charter memberships that will ever exist. */
export const CHARTER_LIMIT = 50

/**
 * How many of the 50 charter spots are still open.
 *
 * Reads the Postgres function `get_charter_slots_remaining()`, which counts
 * `shop_subscriptions` rows with `is_charter_member = true` server-side and is
 * granted to both `anon` and `authenticated` so the signed-out landing page can
 * call it.
 *
 * ON ANY ERROR THIS RETURNS 0, NEVER THROWS. Two reasons:
 *   1. The public marketing page calls this on every render. A migration that
 *      has not been applied yet, an RPC permission change, or a Supabase blip
 *      must degrade into a plain page — never a 500 for an anonymous visitor.
 *   2. 0 fails safe. The UI hides every charter callout at 0, so an error makes
 *      us quietly under-promise. Defaulting to CHARTER_LIMIT would do the
 *      opposite: advertise a price-lock-forever offer we might not be able to
 *      honor. Under-promising is recoverable; over-promising is not.
 */
export async function getCharterSlotsRemaining(): Promise<number> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('get_charter_slots_remaining')
    if (error) return 0

    const remaining = typeof data === 'number' ? data : Number(data)
    if (!Number.isFinite(remaining)) return 0

    // Clamp: the RPC should never exceed the limit or go negative, but the
    // public page must not render "62 of 50 spots left" if it ever does.
    return Math.max(0, Math.min(CHARTER_LIMIT, Math.floor(remaining)))
  } catch {
    return 0
  }
}

/**
 * Assign a charter membership to a shop if any of the 50 remain.
 *
 * Called from the Stripe webhook after a subscription activates, using the
 * service-role client because no user session exists in a webhook request.
 *
 * RACE NOTE: this re-reads the remaining count and then writes, so it is
 * check-then-act. The definitive count is the DB-side one in
 * `get_charter_slots_remaining()`; the accepted known edge is that two
 * simultaneous 50th signups could both pass the check and produce 51 charter
 * members. That is deliberate — a duplicate charter member costs us one locked
 * price, while a lock/transaction here would risk failing a webhook that has
 * already been paid for. Do not "fix" it by throwing on contention.
 *
 * Returns true when this call granted the membership.
 */
export async function claimCharterSlot(shopId: string): Promise<boolean> {
  try {
    const supabase = createServiceClient()

    const { data: remainingRaw, error: rpcError } = await supabase.rpc(
      'get_charter_slots_remaining',
    )
    if (rpcError) return false

    const remaining = typeof remainingRaw === 'number' ? remainingRaw : Number(remainingRaw)
    if (!Number.isFinite(remaining) || remaining <= 0) return false

    // Only ever flips false -> true. There is no code path anywhere in this
    // codebase that sets is_charter_member back to false, and there must not be.
    const { error: updateError } = await supabase
      .from('shop_subscriptions')
      .update({ is_charter_member: true })
      .eq('shop_id', shopId)
      .eq('is_charter_member', false)

    return !updateError
  } catch {
    return false
  }
}

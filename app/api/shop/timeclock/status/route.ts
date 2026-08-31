// GET /api/shop/timeclock/status
//
// The live roster the manager board polls, and the status banner the tech
// screen polls. Role-scoped: a `tech` caller gets exactly one entry — their
// own — so no other tech's name, state or hours ever reaches that page.

import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { buildStatus } from '../_queries'

export async function GET(): Promise<Response> {
  const auth = await apiContext()
  if (!auth.ctx) return auth.error
  const ctx = auth.ctx

  const supabase = await createClient()

  const payload = await buildStatus(supabase, {
    shopId: ctx.shop.id,
    selfTech: ctx.tech,
    selfOnly: ctx.role === 'tech',
    now: new Date(),
  })

  return Response.json(payload)
}

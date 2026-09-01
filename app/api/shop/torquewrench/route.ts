// GET   /api/shop/torquewrench — the shop's review-request settings.
// PATCH /api/shop/torquewrench — update them.
//
// Two gates, both required: `torquewrench` is what the SHOP bought, and
// `manageCustomers` is what the PERSON may do. A tech must not be able to point
// the shop's review link at a place id of their choosing, or switch off the
// feature the owner is paying for.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, asBoolean, asNumber, asText, readJsonBody } from '@/lib/shop/jobs'
import { loadReviewSettings, saveReviewSettings } from '@/lib/shop/torquewrench/data'
import { DEFAULT_DELAY_MINUTES } from '@/lib/shop/torquewrench/types'

export async function GET() {
  const { ctx, error } = await apiFeature('torquewrench', 'manageCustomers')
  if (error) return error

  const supabase = await createClient()
  const { settings, tablesMissing } = await loadReviewSettings(supabase, ctx.shop.id)

  return Response.json({ settings, tablesMissing })
}

export async function PATCH(req: NextRequest) {
  const { ctx, error } = await apiFeature('torquewrench', 'manageCustomers')
  if (error) return error

  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const supabase = await createClient()

  // PATCH is a partial update, so anything the caller left out keeps the value
  // it already has rather than being reset to a default.
  const { settings: current } = await loadReviewSettings(supabase, ctx.shop.id)

  const result = await saveReviewSettings(supabase, ctx.shop.id, {
    is_enabled:
      asBoolean(body.is_enabled) ?? current.is_enabled,
    google_place_id:
      'google_place_id' in body ? asText(body.google_place_id) : current.google_place_id,
    service_recovery_phone:
      'service_recovery_phone' in body
        ? asText(body.service_recovery_phone)
        : current.service_recovery_phone,
    delay_minutes:
      asNumber(body.delay_minutes) ?? current.delay_minutes ?? DEFAULT_DELAY_MINUTES,
    message_template:
      'message_template' in body ? asText(body.message_template) : current.message_template,
  })

  if (!result.ok) {
    return apiError(result.message, result.tablesMissing ? 503 : 400)
  }

  return Response.json({ settings: result.settings })
}

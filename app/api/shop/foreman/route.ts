// GET   /api/shop/foreman — the shop's Foreman AI settings
// PATCH /api/shop/foreman — update hours, greeting, services, after-hours copy
//
// Gated on the `foreman_ai` feature (every shop type, elite tier) plus
// manageBilling — Foreman answers the phone as the business, and it carries a
// per-number recurring cost, so it sits with whoever owns the money.
//
// The phone number and the Vapi phone-number id are NOT patchable here. They
// come from a manual provisioning process (see lib/shop/foreman/provision.ts)
// and letting the UI write them would imply this app can allocate a number. It
// cannot.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, asBoolean, asText, readJsonBody } from '@/lib/shop/jobs'
import {
  WEEKDAY_ABBREVIATIONS,
  isWeekdayAbbreviation,
  loadForemanSettings,
  saveForemanSettings,
  type ForemanSettingsPatch,
} from '@/lib/shop/foreman/settings'

/** "08:00" / "8:00" → "08:00". Anything else is rejected rather than coerced. */
function asTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function asWorkingDays(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const days = new Set<string>(value.filter(isWeekdayAbbreviation))
  // Deduped, and left in calendar order rather than the order they arrived.
  return WEEKDAY_ABBREVIATIONS.filter((day) => days.has(day))
}

export async function GET() {
  const { ctx, error } = await apiFeature('foreman_ai', 'manageBilling')
  if (error) return error

  const supabase = await createClient()
  const result = await loadForemanSettings(supabase, ctx.shop.id)

  if (!result.ok) {
    return apiError(result.message, result.reason === 'missing_table' ? 503 : 400)
  }

  return Response.json({ settings: result.settings, exists: result.exists })
}

export async function PATCH(req: NextRequest) {
  const { ctx, error } = await apiFeature('foreman_ai', 'manageBilling')
  if (error) return error

  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const patch: ForemanSettingsPatch = {}

  if ('is_enabled' in body) {
    const enabled = asBoolean(body.is_enabled)
    if (enabled === null) return apiError('is_enabled must be true or false.', 400)
    patch.is_enabled = enabled
  }

  if ('greeting' in body) patch.greeting = asText(body.greeting)
  if ('after_hours_message' in body) patch.after_hours_message = asText(body.after_hours_message)
  if ('services_list' in body) patch.services_list = asText(body.services_list)

  if ('working_hours_start' in body) {
    const start = asTime(body.working_hours_start)
    if (!start) return apiError('Opening time must look like 08:00.', 400)
    patch.working_hours_start = start
  }

  if ('working_hours_end' in body) {
    const end = asTime(body.working_hours_end)
    if (!end) return apiError('Closing time must look like 18:00.', 400)
    patch.working_hours_end = end
  }

  if ('working_days' in body) {
    const days = asWorkingDays(body.working_days)
    if (!days || days.length === 0) {
      return apiError('Pick at least one working day.', 400)
    }
    patch.working_days = days
  }

  if (
    patch.working_hours_start &&
    patch.working_hours_end &&
    patch.working_hours_start >= patch.working_hours_end
  ) {
    return apiError('Closing time must be after opening time.', 400)
  }

  if (Object.keys(patch).length === 0) return apiError('Nothing to update.', 400)

  const supabase = await createClient()
  const result = await saveForemanSettings(supabase, ctx.shop.id, patch)

  if (!result.ok) {
    return apiError(result.message, result.reason === 'missing_table' ? 503 : 400)
  }

  // Turning Foreman "on" without a provisioned number changes nothing — say so
  // rather than letting the toggle imply the phone is now answered.
  const warning =
    result.settings.is_enabled && !result.settings.phone_number
      ? 'Foreman is switched on but no phone number is attached to this shop yet, so no calls will be answered. See the setup checklist.'
      : null

  return Response.json({ settings: result.settings, warning })
}

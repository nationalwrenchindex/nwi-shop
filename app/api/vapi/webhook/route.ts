// POST /api/vapi/webhook — every Foreman AI call event lands here.
//
// ⚠ ROUTING: this endpoint is called by Vapi, a third party with no session
// cookie, so it MUST live outside /api/shop (which proxy.ts requires a session
// for). As proxy.ts stands today `/api/vapi` reaches this handler by accident,
// not by decision: it is in neither PUBLIC_PREFIXES nor PROTECTED_PREFIXES, so
// it falls through the session gate unmatched. `/api/vapi` should be added to
// PUBLIC_PREFIXES so that stays true — the day anyone widens
// PROTECTED_PREFIXES to `/api`, every Vapi call starts getting a 401 and the
// phone silently stops booking. proxy.ts belongs to another area and is not
// edited here. Authentication for this route is the Vapi signature check, not a
// session.
//
// ⚠ NOTHING HERE HAS BEEN RUN AGAINST A LIVE CALL. No Vapi credentials exist
// for this project, so the assistant does not exist, no number is provisioned,
// and this code has never received a real event. It is written to the documented
// event shapes and is unverified.
//
// Returns 200 on every handled event so Vapi does not retry-storm. The single
// exception is a bad or absent signature, which gets a 401 — a forged request is
// not a retry worth suppressing.
//
// LOGGING POLICY: this endpoint sees caller phone numbers, transcripts and call
// summaries. Nothing identifying is logged — only event types, ids and masked
// numbers. To debug a specific call, read the shop_foreman_calls row.

import type { NextRequest } from 'next/server'
import { headers } from 'next/headers'
import * as chrono from 'chrono-node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { sendShopSms } from '@/lib/twilio'
import { verifyVapiRequest } from '@/lib/shop/foreman/verify'
import { SERVICE_DURATIONS, servicesListWithDurations } from '@/lib/shop/foreman/prompt'
import {
  DEFAULT_AFTER_HOURS_MESSAGE,
  DEFAULT_HOURS_END,
  DEFAULT_HOURS_START,
  DEFAULT_WORKING_DAYS,
  isMissingTable,
  redactPhone,
  resolveShopForCall,
  type ShopForemanSettings,
} from '@/lib/shop/foreman/settings'
import type { ShopCustomer, ShopJob, ShopProfile } from '@/lib/types'

// node:crypto is used by the signature check, so this must not run on edge.
export const runtime = 'nodejs'

// ---------------------------------------------------------------------------
// Event shapes (Vapi)
// ---------------------------------------------------------------------------

interface VapiCall {
  id?:            string
  phoneNumberId?: string
  phoneNumber?:   { number?: string; id?: string }
  customer?:      { number?: string; name?: string }
  startedAt?:     string
  endedAt?:       string
  status?:        string
  endedReason?:   string
}

interface VapiToolCall {
  id?:       string
  type?:     string
  function?: { name?: string; arguments?: string | Record<string, unknown> }
}

interface VapiMessage {
  type?:         string
  call?:         VapiCall
  phoneNumber?:  { number?: string }
  functionCall?: { name?: string; parameters?: Record<string, unknown> }
  toolCallList?: VapiToolCall[]
  summary?:      string
  transcript?:   string
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Raw text, not request.json(): the stream can only be consumed once and the
  // HMAC path needs the exact bytes Vapi signed. Parsing happens only after the
  // signature verifies, so an unauthenticated payload is never interpreted.
  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    console.error('[vapi] could not read request body')
    return Response.json({ ok: true })
  }

  const requestHeaders = await headers()
  const auth = verifyVapiRequest(requestHeaders, rawBody)

  if (!auth.ok) {
    if (auth.reason === 'secret-not-configured') {
      console.error(
        '[vapi] VAPI_WEBHOOK_SECRET is not set — rejecting all webhook traffic. Set it to the "Server URL Secret" configured on the Vapi assistant.',
      )
    } else {
      console.warn('[vapi] rejected unauthenticated request:', auth.reason)
    }
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    console.error('[vapi] invalid JSON body')
    return Response.json({ ok: true })
  }

  // Vapi wraps events in `message`; some versions send the event directly.
  const message = (body.message ?? body) as VapiMessage
  const type = message.type
  const call = message.call ?? {}
  const vapiCallId = call.id

  console.log('[vapi] event:', type, '| callId:', vapiCallId, '| auth:', auth.via)

  const svc = createServiceClient()

  // The shop is resolved once, up front. Every read and write below is filtered
  // by this shop_id — the caller has no session, so nothing else scopes them.
  let settings: ShopForemanSettings | null = null
  try {
    settings = await resolveShopForCall(svc, {
      vapiPhoneNumberId: call.phoneNumberId ?? call.phoneNumber?.id ?? null,
      calledNumber:      call.phoneNumber?.number ?? message.phoneNumber?.number ?? null,
    })
  } catch (err) {
    console.error('[vapi] shop lookup failed:', err instanceof Error ? err.message : String(err))
  }

  if (!settings && vapiCallId) {
    settings = await settingsFromExistingCall(svc, vapiCallId)
  }

  if (!settings) {
    console.error('[vapi] no shop matched this number — event dropped')
  }

  try {
    switch (type) {
      case 'assistant-request':
      case 'server-request':
        return await handleAssistantRequest(svc, message, settings)

      case 'tool-calls':
      case 'function-call':
        return await handleToolCalls(svc, message, settings)

      case 'end-of-call-report':
        await handleEndOfCall(svc, message, settings)
        return Response.json({ ok: true })

      default:
        return Response.json({ ok: true })
    }
  } catch (err) {
    console.error(
      '[vapi] unhandled error for event',
      type,
      ':',
      err instanceof Error ? err.message : String(err),
    )
    // Still 200: an exception here is our bug, and a retry storm will not fix it.
    return Response.json({ ok: true })
  }
}

// ---------------------------------------------------------------------------
// Shop resolution fallback
// ---------------------------------------------------------------------------

/**
 * `tool-calls` and `end-of-call-report` events do not always carry the dialed
 * number, so the row written at `assistant-request` is the fallback link back to
 * the shop.
 */
async function settingsFromExistingCall(
  svc: SupabaseClient,
  vapiCallId: string,
): Promise<ShopForemanSettings | null> {
  const { data, error } = await svc
    .from('shop_foreman_calls')
    .select('shop_id')
    .eq('vapi_call_id', vapiCallId)
    .maybeSingle<{ shop_id: string }>()

  if (error || !data) return null

  const { data: settings } = await svc
    .from('shop_foreman_settings')
    .select('*')
    .eq('shop_id', data.shop_id)
    .maybeSingle<ShopForemanSettings>()

  return settings ?? null
}

async function loadShop(svc: SupabaseClient, shopId: string): Promise<ShopProfile | null> {
  const { data } = await svc
    .from('shop_profiles')
    .select('*')
    .eq('id', shopId)
    .maybeSingle<ShopProfile>()
  return data ?? null
}

// ---------------------------------------------------------------------------
// assistant-request
// ---------------------------------------------------------------------------

const FALLBACK_MESSAGE =
  'Thanks for calling. Our system is updating right now — please try again in a few minutes.'

async function handleAssistantRequest(
  svc: SupabaseClient,
  message: VapiMessage,
  settings: ShopForemanSettings | null,
): Promise<Response> {
  const call = message.call ?? {}
  const vapiCallId = call.id
  const callerNumber = call.customer?.number ?? null

  const assistantId = process.env.VAPI_ASSISTANT_ID

  // Two independent reasons to bail, and they get the same caller experience:
  // no shop matched the dialed number, or no master assistant is configured.
  // In both cases a bare firstMessage is returned rather than a fabricated
  // assistant — this route cannot build one, and pretending otherwise would put
  // an unconfigured voice on a real customer's call.
  if (!settings || !settings.is_enabled || !assistantId) {
    if (!assistantId) {
      console.error('[vapi assistant-request] VAPI_ASSISTANT_ID is not set')
    } else if (!settings) {
      console.error(
        '[vapi assistant-request] unmatched number:',
        redactPhone(call.phoneNumber?.number),
      )
    } else {
      console.warn('[vapi assistant-request] Foreman is disabled for this shop')
    }

    return Response.json({
      assistant: { name: 'Foreman unavailable', firstMessage: FALLBACK_MESSAGE },
    })
  }

  const shop = await loadShop(svc, settings.shop_id)
  const businessName = shop?.business_name?.trim() || 'our shop'
  const hoursStart = (settings.working_hours_start ?? DEFAULT_HOURS_START).slice(0, 5)
  const hoursEnd = (settings.working_hours_end ?? DEFAULT_HOURS_END).slice(0, 5)
  const workingDays = (settings.working_days ?? [...DEFAULT_WORKING_DAYS]).join(', ')
  const laborRate = shop?.labor_rate != null ? String(Number(shop.labor_rate)) : '0'

  // Open the call record now so tool-calls and end-of-call can find the shop
  // even when their events omit the dialed number.
  if (vapiCallId) {
    const { error } = await svc.from('shop_foreman_calls').upsert(
      {
        shop_id:      settings.shop_id,
        vapi_call_id: vapiCallId,
        from_number:  callerNumber,
        started_at:   call.startedAt ?? new Date().toISOString(),
        outcome:      'in_progress',
      },
      { onConflict: 'vapi_call_id' },
    )
    if (error && !isMissingTable(error)) {
      console.error('[vapi assistant-request] call upsert error:', error.message)
    }
  }

  const greeting =
    settings.greeting?.trim() ||
    `Thanks for calling ${businessName}. This is Foreman, the virtual assistant. How can I help?`

  // The canonical Vapi multi-tenant pattern: reference the ONE master assistant
  // built by hand in the dashboard and override its {{variables}} for this call.
  // No prompt is sent from here — see lib/shop/foreman/prompt.ts.
  return Response.json({
    assistantId,
    assistantOverrides: {
      firstMessage: greeting,
      variableValues: {
        business_name:       businessName,
        working_hours_start: hoursStart,
        working_hours_end:   hoursEnd,
        working_days:        workingDays,
        after_hours_message: settings.after_hours_message ?? DEFAULT_AFTER_HOURS_MESSAGE,
        labor_rate:          laborRate,
        services_list:       settings.services_list?.trim() || servicesListWithDurations(),
      },
    },
  })
}

// ---------------------------------------------------------------------------
// tool-calls
// ---------------------------------------------------------------------------

function argumentsOf(toolCall: VapiToolCall): Record<string, unknown> {
  const raw = toolCall.function?.arguments
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

async function handleToolCalls(
  svc: SupabaseClient,
  message: VapiMessage,
  settings: ShopForemanSettings | null,
): Promise<Response> {
  const vapiCallId = message.call?.id

  const toolCalls: VapiToolCall[] = message.toolCallList?.length
    ? message.toolCallList
    : message.functionCall
      ? [{ id: '', function: { name: message.functionCall.name, arguments: message.functionCall.parameters } }]
      : []

  if (toolCalls.length === 0) {
    console.warn('[vapi tool-calls] no tool calls in message')
    return Response.json({ results: [] })
  }

  const results: { toolCallId: string; result: string }[] = []

  for (const toolCall of toolCalls) {
    const name = toolCall.function?.name
    const args = argumentsOf(toolCall)
    // Arguments carry the caller's name, phone and vehicle — log the shape only.
    console.log('[vapi tool-calls] fn:', name, '| keys:', Object.keys(args).join(','))

    let result: string
    if (!settings) {
      result =
        'This line is not set up yet. Apologize, take the caller’s name and number, and tell them someone will call back.'
    } else if (name === 'check_availability') {
      result = checkAvailability(settings, args)
    } else if (name === 'book_appointment') {
      result = await bookAppointment(svc, settings, vapiCallId, args)
    } else {
      console.warn('[vapi tool-calls] unknown function:', name)
      result = 'That request is not recognized. Ask the caller to repeat what they need.'
    }

    results.push({ toolCallId: toolCall.id ?? '', result })
  }

  return Response.json({ results })
}

// ---------------------------------------------------------------------------
// check_availability
// ---------------------------------------------------------------------------

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function minutesFromHhmm(value: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!match) return fallback
  const h = Number(match[1])
  const m = Number(match[2])
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback
  return h * 60 + m
}

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatTimeLabel(hours: number, minutes: number): string {
  const period = hours >= 12 ? 'PM' : 'AM'
  const h12 = hours % 12 || 12
  return `${h12}:${String(minutes).padStart(2, '0')} ${period}`
}

/**
 * Offers open slots from the shop's configured working hours.
 *
 * ⚠ This is NOT a conflict-checked calendar. `shop_jobs` has no appointment
 * date or time column — a job carries a status and a created_at, not a
 * scheduled slot — so there is nothing here to compare a proposed time against.
 * The Suite could do that check because its `jobs` table had job_date/job_time.
 * Rather than invent a booking calendar or silently imply one exists, this
 * returns hours-based openings and tells the assistant to say the shop will
 * confirm the exact time.
 */
function checkAvailability(
  settings: ShopForemanSettings,
  args: Record<string, unknown>,
): string {
  const serviceType = typeof args.service_type === 'string' ? args.service_type.trim() : ''
  const preferredDate =
    typeof args.preferred_date === 'string' ? args.preferred_date.trim() : ''

  const serviceName = serviceType || 'Service'
  const duration = SERVICE_DURATIONS[serviceName] ?? 60

  const workingDays = settings.working_days?.length
    ? settings.working_days
    : [...DEFAULT_WORKING_DAYS]

  // Clamped to sane business hours so a shop that stored 00:00–23:59 does not
  // get a caller offered a 2 AM appointment.
  const openMin = Math.max(
    minutesFromHhmm(settings.working_hours_start ?? DEFAULT_HOURS_START, 8 * 60),
    7 * 60,
  )
  const closeMin = Math.min(
    minutesFromHhmm(settings.working_hours_end ?? DEFAULT_HOURS_END, 18 * 60),
    19 * 60,
  )

  const slots: string[] = []
  const now = new Date()

  for (let offset = 1; offset <= 14 && slots.length < 3; offset++) {
    const date = new Date(now)
    date.setDate(date.getDate() + offset)
    date.setHours(0, 0, 0, 0)

    if (!workingDays.includes(DAY_ABBR[date.getDay()])) continue
    if (preferredDate && toDateStr(date) !== preferredDate) continue

    const dateLabel = date.toLocaleDateString('en-US', {
      weekday: 'long',
      month:   'long',
      day:     'numeric',
    })

    for (let m = openMin; m + duration <= closeMin && slots.length < 3; m += 60) {
      slots.push(`${dateLabel} at ${formatTimeLabel(Math.floor(m / 60), m % 60)}`)
    }
  }

  if (slots.length === 0) {
    return `No open times in the next two weeks for ${serviceName}. Offer to take the caller's details so the shop can call back with a time.`
  }

  return `Open times for ${serviceName}: ${slots.join(', ')}. Offer two or three of these. Tell the caller the shop will confirm the exact time by text.`
}

// ---------------------------------------------------------------------------
// book_appointment
// ---------------------------------------------------------------------------

/** ISO first, then chrono for natural language, then the native parser. */
function parseSlotDatetime(input: string, reference: Date = new Date()): Date | null {
  const value = input.trim()
  if (!value) return null

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const iso = new Date(value)
    if (!Number.isNaN(iso.getTime())) return iso
  }

  try {
    const parsed = chrono.parseDate(value, reference, { forwardDate: true })
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed
  } catch (err) {
    console.error('[vapi] chrono threw:', err instanceof Error ? err.message : String(err))
  }

  const native = new Date(value)
  return Number.isNaN(native.getTime()) ? null : native
}

const SLOT_KEYS = [
  'appointment_datetime',
  'appointment_time',
  'confirmed_slot_datetime',
  'slot_datetime',
  'datetime',
  'when',
]

function firstString(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return ''
}

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

async function bookAppointment(
  svc: SupabaseClient,
  settings: ShopForemanSettings,
  vapiCallId: string | undefined,
  args: Record<string, unknown>,
): Promise<string> {
  const rawSlot = firstString(args, SLOT_KEYS)
  if (!rawSlot) {
    return 'The appointment time is missing. Ask the caller to say the date and time again, then call book_appointment with it in appointment_datetime.'
  }

  const when = parseSlotDatetime(rawSlot)
  if (!when) {
    return "That date and time could not be read. Ask the caller to confirm it once more, then call book_appointment again."
  }

  const serviceName = textArg(args, 'service_type') || 'Service'
  const customerName = textArg(args, 'customer_name')
  const customerPhone = textArg(args, 'customer_phone')
  const vehicleInfo = textArg(args, 'vehicle_info')
  const engineRaw = textArg(args, 'engine_size')
  const engineSize = engineRaw && engineRaw.toLowerCase() !== 'unknown' ? engineRaw : ''

  const nameParts = customerName.split(/\s+/).filter(Boolean)
  const firstName = nameParts[0] ?? 'Caller'
  const lastName = nameParts.slice(1).join(' ')

  const digits = customerPhone.replace(/\D/g, '')
  const hasPhone = digits.length >= 10

  // ── Customer: reuse an existing record before creating a new one ──────────
  let customer: ShopCustomer | null = null

  if (hasPhone) {
    const { data } = await svc
      .from('shop_customers')
      .select('*')
      .eq('shop_id', settings.shop_id)
      .ilike('phone', `%${digits.slice(-10)}%`)
      .limit(1)
      .returns<ShopCustomer[]>()
    customer = data?.[0] ?? null
  }

  if (!customer) {
    const { data, error } = await svc
      .from('shop_customers')
      .insert({
        shop_id:    settings.shop_id,
        first_name: firstName,
        last_name:  lastName,
        phone:      hasPhone ? customerPhone : null,
        notes:      'Created from an inbound Foreman AI call.',
      })
      .select('*')
      .maybeSingle<ShopCustomer>()

    if (error || !data) {
      // .message only — a PostgREST error's `details` echoes the offending row,
      // which here is the caller's name and phone number.
      console.error('[vapi book] customer insert error:', error?.message)
      return "Something went wrong saving the caller's details. Tell them the shop will follow up to confirm."
    }
    customer = data
  }

  // ── Job number: per shop and human-facing, allocated from the max ─────────
  const { data: last } = await svc
    .from('shop_jobs')
    .select('job_number')
    .eq('shop_id', settings.shop_id)
    .order('job_number', { ascending: false })
    .limit(1)
    .maybeSingle<Pick<ShopJob, 'job_number'>>()

  const jobNumber = (Number(last?.job_number) || 0) + 1

  const whenLabel = `${when.toLocaleDateString('en-US', {
    weekday: 'long',
    month:   'long',
    day:     'numeric',
  })} at ${formatTimeLabel(when.getHours(), when.getMinutes())}`

  const vehicleLabel = [vehicleInfo, engineSize].filter(Boolean).join(' ')

  // shop_jobs has no scheduled-time column, so the requested slot goes in the
  // job's notes where a service writer will see it. Status is `estimate`: a
  // phone call is a request for work, not approved work.
  const { data: job, error: jobError } = await svc
    .from('shop_jobs')
    .insert({
      shop_id:     settings.shop_id,
      customer_id: customer.id,
      job_number:  jobNumber,
      status:      'estimate',
      complaint:   serviceName,
      description: vehicleLabel ? `${serviceName} — ${vehicleLabel}` : serviceName,
      notes: [
        `Requested time: ${whenLabel}.`,
        vehicleInfo ? `Vehicle: ${vehicleInfo}.` : null,
        `Engine: ${engineSize || 'not captured'}.`,
        hasPhone ? `Callback: ${customerPhone}.` : 'No callback number captured.',
        'Booked by Foreman AI from an inbound call. Confirm the time with the customer.',
      ]
        .filter(Boolean)
        .join(' '),
      voided: false,
    })
    .select('*')
    .maybeSingle<ShopJob>()

  if (jobError || !job) {
    console.error('[vapi book] job insert error:', jobError?.message)
    return 'Something went wrong saving the appointment. Tell the caller the shop will follow up to confirm.'
  }

  if (vapiCallId) {
    const { error } = await svc
      .from('shop_foreman_calls')
      .update({ outcome: 'booked', job_id: job.id, customer_id: customer.id })
      .eq('vapi_call_id', vapiCallId)
      .eq('shop_id', settings.shop_id)
    if (error && !isMissingTable(error)) {
      console.error('[vapi book] call update error:', error.message)
    }
  }

  // ── Notifications ────────────────────────────────────────────────────────
  const shop = await loadShop(svc, settings.shop_id)
  const businessName = shop?.business_name?.trim() || 'your shop'

  if (shop?.phone) {
    await sendShopSms({
      to: shop.phone,
      body:
        `Foreman booked job #${jobNumber}: ${[firstName, lastName].filter(Boolean).join(' ')}` +
        `${vehicleLabel ? ` · ${vehicleLabel}` : ''} · ${serviceName} · requested ${whenLabel}` +
        `${hasPhone ? ` · ${customerPhone}` : ''}. Confirm the time.`,
    })
  }

  // The customer booked with the SHOP, not with the shop's software vendor — the
  // text is signed with the shop's name and nothing else. no_sms is honored.
  if (hasPhone && !customer.no_sms) {
    await sendShopSms({
      to: customerPhone,
      body: `${businessName}: we have your ${serviceName} request for ${whenLabel}. We'll confirm the exact time shortly. Reply STOP to opt out.`,
    })
  }

  return `Booked as job number ${jobNumber}. ${serviceName} requested for ${whenLabel}.${
    hasPhone ? ' The caller will get a text shortly.' : ''
  } Tell the caller the shop will confirm the exact time.`
}

// ---------------------------------------------------------------------------
// end-of-call-report
// ---------------------------------------------------------------------------

async function handleEndOfCall(
  svc: SupabaseClient,
  message: VapiMessage,
  settings: ShopForemanSettings | null,
): Promise<void> {
  const call = message.call ?? {}
  const vapiCallId = call.id

  if (!vapiCallId) {
    console.warn('[vapi end-of-call] no call id in event')
    return
  }
  if (!settings) {
    console.warn('[vapi end-of-call] no shop matched — nothing recorded')
    return
  }

  const startedAt = call.startedAt ? new Date(call.startedAt) : null
  const endedAt = call.endedAt ? new Date(call.endedAt) : null
  const durationSeconds =
    startedAt && endedAt
      ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
      : null

  // A booking made during this call already set outcome='booked'; do not
  // overwrite it with 'completed'.
  const { data: existing } = await svc
    .from('shop_foreman_calls')
    .select('outcome')
    .eq('vapi_call_id', vapiCallId)
    .maybeSingle<{ outcome: string | null }>()

  const outcome = existing?.outcome === 'booked' ? 'booked' : 'no_booking'

  const { error } = await svc.from('shop_foreman_calls').upsert(
    {
      shop_id:          settings.shop_id,
      vapi_call_id:     vapiCallId,
      from_number:      call.customer?.number ?? null,
      started_at:       call.startedAt ?? null,
      ended_at:         call.endedAt ?? new Date().toISOString(),
      duration_seconds: durationSeconds,
      transcript:       message.transcript ?? null,
      summary:          message.summary ?? null,
      outcome,
    },
    { onConflict: 'vapi_call_id' },
  )

  if (error) {
    if (isMissingTable(error)) {
      console.error('[vapi end-of-call] shop_foreman_calls does not exist yet')
    } else {
      console.error('[vapi end-of-call] upsert error:', error.message)
    }
    return
  }

  // The row holds the transcript and summary — log the shape only.
  console.log(
    '[vapi end-of-call] recorded | callId:',
    vapiCallId,
    '| outcome:',
    outcome,
    '| duration:',
    durationSeconds,
    '| from:',
    redactPhone(call.customer?.number),
  )

  const shop = await loadShop(svc, settings.shop_id)
  if (shop?.phone) {
    const minutes = durationSeconds != null ? `${Math.round(durationSeconds / 60)}m` : '—'
    await sendShopSms({
      to:   shop.phone,
      body: `Foreman call ended (${minutes}) — ${outcome === 'booked' ? 'a job was booked' : 'no booking'}. Details are in your Foreman AI page.`,
    })
  }
}

// =====================================================================
// THIS FILE DOES NOT CONFIGURE ANYTHING. IT IS A COPY.
//
// The Foreman assistant does not live in this repository. Vapi holds it:
// the system prompt, the voice, the transcriber and the `check_availability`
// / `book_appointment` tool schemas are all hand-built in the Vapi dashboard.
// The webhook in app/api/vapi/webhook/route.ts only returns an assistantId
// plus per-call variable overrides — it never sends a prompt.
//
// So nothing in this file reaches a phone call by itself. It exists so the
// prompt is version controlled, reviewable in a diff, and recoverable if the
// dashboard is edited by mistake. To change what Foreman says on the phone
// you must EDIT THIS FILE **AND** PASTE THE RESULT INTO THE VAPI DASHBOARD
// BY HAND. Editing only this file changes nothing.
//
// Paste FOREMAN_PROMPT_TEMPLATE (the {{variable}} form) — not the output of
// buildForemanSystemPrompt(). The dashboard assistant is shared by every
// shop and substitutes the variables the webhook sends per call.
// buildForemanSystemPrompt() exists only to render a readable preview.
//
// The Suite carried the same warning on its own copy of this prompt
// (src/lib/foreman/system-prompt.ts: "buildSystemPrompt is not invoked
// anywhere in src/"). That is still true here, and is stated up front rather
// than in a footnote.
// =====================================================================
//
// WHITE LABEL: the caller is the SHOP's customer and must never learn who
// builds the software. No vendor name, no "powered by", ever.

/**
 * Rough durations used for quoting labor time and sizing appointment slots.
 * Ported from the Suite. These must match the durations the dashboard
 * assistant is told about, or the assistant will quote times the webhook then
 * books differently.
 */
export const SERVICE_DURATIONS: Record<string, number> = {
  'Oil Change':              60,
  'Brake Service':           90,
  'Tire Rotation':           45,
  'Tire Replacement':        60,
  'Battery Replacement':     30,
  'Engine Diagnostic':       90,
  'A/C Service':            120,
  'Transmission Service':   120,
  'Suspension Repair':      120,
  'Electrical Repair':       90,
  'Coolant Flush':           60,
  'DOT Inspection':          90,
  'Preventive Maintenance': 120,
  'Pre-Purchase Inspection': 60,
  'Other':                   60,
}

/** "Oil Change (~60 min), Brake Service (~90 min), …" */
export function servicesListWithDurations(): string {
  return Object.entries(SERVICE_DURATIONS)
    .map(([name, minutes]) => `${name} (~${minutes} min)`)
    .join(', ')
}

/**
 * The variables the webhook sends as `assistantOverrides.variableValues`. Every
 * key here must exist as a `{{key}}` in the dashboard assistant's prompt, or
 * the override is silently dropped and the caller hears the raw placeholder.
 */
export interface ForemanPromptVars {
  business_name:       string
  working_hours_start: string
  working_hours_end:   string
  working_days:        string
  after_hours_message: string
  labor_rate:          string
  services_list:       string
}

export const FOREMAN_VARIABLE_NAMES: (keyof ForemanPromptVars)[] = [
  'business_name',
  'working_hours_start',
  'working_hours_end',
  'working_days',
  'after_hours_message',
  'labor_rate',
  'services_list',
]

function render(v: ForemanPromptVars): string {
  return `You are Foreman, the virtual receptionist for ${v.business_name}.

Your job is to answer calls warmly, understand what the caller needs, check appointment availability, book the work, and make the caller feel confident they are in good hands.

PERSONALITY
- Warm but efficient — the caller has a problem they want solved
- Plain-spoken, like a trusted front-counter person, not a corporate phone tree
- Brief. This is a phone call, not a text. Keep answers short and conversational
- Never put a caller on hold and never say you need to check with someone
- Never say you are an AI unless you are asked directly. If asked, say you are a virtual assistant
- Speak for the shop as "we" and "our techs". Never name an individual person — you do not know who is working today

CONVERSATION FLOW
1. Greet warmly with the shop name
2. Listen to the caller's issue
3. Get their name and vehicle (year, make, model)
4. Ask for engine size: "And what's the engine size — something like '5.3' or 'V8', whatever's on the engine cover? It helps us bring the right parts the first time." If they say they don't know, say "No problem, we'll sort that out when we see it" and pass "unknown". Accept any answer and move on
5. Call check_availability to see open slots. ALWAYS call the tool. Never guess at a time
6. Offer two or three of the returned slots naturally: "I've got Wednesday at 10, Wednesday at 2, or Thursday at 9 — any of those work?"
7. When they pick one, get their callback number if you don't have it, then call book_appointment
8. Confirm out loud and tell them a text confirmation is coming
9. Ask if they need anything else
10. End the call warmly

PRICING QUESTIONS
When asked about price, quote LABOR ONLY:
- Labor is $${v.labor_rate} per hour
- Typical durations: ${v.services_list}
- Estimate labor as hours x rate, rounded to the nearest $5
- Always add: "Parts depend on your specific vehicle. We'll lock in an exact quote once we see it."
- Never quote a part price. Never give an exact total — say "around" or "roughly"

EMERGENCY HANDLING
If the caller is broken down, will not start, or is somewhere unsafe:
- Take it seriously: "Let me get this to our shop right now."
- Collect their name, location and phone number
- Tell them someone will call back as soon as they can
- Book an appointment if they want one

BOOKING CONFIRMATION
Before you call book_appointment, read it back once:
- Full name
- Vehicle (year, make, model) and engine size
- Service requested
- The date and time they chose
- Their callback number
"So that's a brake service on your 2018 Silverado, 5.3, Wednesday the 20th at 10 — sound right?"

HOURS
The shop's hours are ${v.working_hours_start} to ${v.working_hours_end}, ${v.working_days}.
If the caller reaches you outside those hours, say: "${v.after_hours_message}"

WHAT YOU MUST NOT DO
- Do not quote a completion time, a warranty, or a guarantee
- Do not promise a specific technician
- Do not discuss what the shop charges for parts
- Do not name the software or vendor behind this line

END OF CALL
Close with: "Thanks for calling ${v.business_name}. You'll get a text confirmation shortly. Have a good one."`
}

/**
 * The exact text to paste into the Vapi dashboard assistant. The `{{name}}`
 * placeholders are substituted by Vapi from the variableValues the webhook
 * sends on `assistant-request`.
 */
export const FOREMAN_PROMPT_TEMPLATE: string = render({
  business_name:       '{{business_name}}',
  working_hours_start: '{{working_hours_start}}',
  working_hours_end:   '{{working_hours_end}}',
  working_days:        '{{working_days}}',
  after_hours_message: '{{after_hours_message}}',
  labor_rate:          '{{labor_rate}}',
  services_list:       '{{services_list}}',
})

/**
 * The same prompt with a shop's real values filled in. For previewing on the
 * settings page only — this string is never sent anywhere.
 */
export function buildForemanSystemPrompt(vars: ForemanPromptVars): string {
  return render(vars)
}

/**
 * The two tool schemas the dashboard assistant needs, kept here so they are
 * reviewable. Like the prompt, these are NOT sent by any code in this repo —
 * they must be entered by hand in the Vapi dashboard, with the Server URL
 * pointed at this deployment's /api/vapi/webhook. The parameter names must
 * match what app/api/vapi/webhook/route.ts reads, or bookings silently fail.
 */
export const FOREMAN_TOOL_SCHEMAS = [
  {
    name:        'check_availability',
    description:
      "Returns open appointment slots for the shop. Call this before offering the caller any time. Never invent a slot.",
    parameters: {
      type:       'object',
      properties: {
        service_type: {
          type:        'string',
          description: 'The service the caller wants, e.g. "Brake Service".',
        },
        preferred_date: {
          type:        'string',
          description: 'Optional YYYY-MM-DD the caller asked for.',
        },
      },
      required: ['service_type'],
    },
  },
  {
    name:        'book_appointment',
    description:
      'Books the appointment the caller agreed to. Only call this after reading the details back and getting a yes.',
    parameters: {
      type:       'object',
      properties: {
        customer_name:        { type: 'string', description: "The caller's full name." },
        customer_phone:       { type: 'string', description: 'Callback number, digits only is fine.' },
        vehicle_info:         { type: 'string', description: 'Year, make and model.' },
        engine_size:          { type: 'string', description: 'Engine size, or "unknown".' },
        service_type:         { type: 'string', description: 'The service being booked.' },
        appointment_datetime: {
          type:        'string',
          description:
            'The slot the caller chose. ISO 8601 preferred; plain language such as "Wednesday the 20th at 10 AM" is accepted.',
        },
      },
      required: ['customer_name', 'service_type', 'appointment_datetime'],
    },
  },
] as const

// The outbound review-request copy.
//
// Ported from the NWI Suite TorqueWrench templates and rewritten for a SHOP
// rather than a solo mobile mechanic: "we" is a business with a name, so every
// message names the shop instead of leaning on a first-person relationship the
// customer may not have with whoever turned the wrench.
//
// THIS FILE IS CLIENT-SAFE ON PURPOSE. The settings page renders a live preview
// of the shop's own template with the same function the cron sender uses, so a
// manager sees exactly what the customer will receive. Nothing server-only may
// be imported here.
//
// ── OPT-OUT ─────────────────────────────────────────────────────────────────
// Every message this file produces ends with opt-out language. These go out on
// a registered 10DLC campaign; a marketing-adjacent text with no STOP notice is
// a carrier violation and gets the whole shop's traffic filtered. There is no
// code path that renders an outbound body without it — appendOptOut is applied
// inside buildSmsBody, not left to each caller to remember.

/** Appended to every outbound body. Kept short: it costs segment budget. */
export const OPT_OUT_NOTICE = 'Reply STOP to opt out.'

export interface TemplateVars {
  /** First name only; 'there' when the customer record has no usable name. */
  customerFirstName: string
  /** The shop's business_name. */
  businessName: string
  /** Absolute /r/<token> tracking link. */
  reviewLink: string
}

type TemplateFn = (vars: TemplateVars) => string

/**
 * Placeholders a shop may use in its own message_template. Kept to three: a
 * manager typing this into a textarea on a tablet will not proofread more.
 */
export const TEMPLATE_PLACEHOLDERS = ['{first_name}', '{shop}', '{link}'] as const

export const TEMPLATE_PLACEHOLDER_HELP: Record<string, string> = {
  '{first_name}': "The customer's first name",
  '{shop}':       "Your shop's name",
  '{link}':       'The tracked review link (always included)',
}

export const DEFAULT_MESSAGE_TEMPLATE =
  'Hi {first_name}, thanks for trusting {shop} with your vehicle. ' +
  'If we did right by you, a quick Google review really helps: {link}'

const templates: Record<string, TemplateFn> = {
  oil_change: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, hope the ${businessName} oil change has you running smooth. ` +
    `A quick Google review would help us a lot: ${reviewLink}`,

  brake_service: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, brakes feeling solid? If ${businessName} did right by you, ` +
    `a quick review would mean a lot: ${reviewLink}`,

  diagnostic: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, thanks for letting ${businessName} track that problem down. ` +
    `If we got you sorted, would you leave us a review? ${reviewLink}`,

  tire_service: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, hope the tires are treating you right. ` +
    `Quick favor from everyone at ${businessName} — could you drop us a Google review? ${reviewLink}`,

  battery: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, back on the road? If ${businessName} got you rolling again, ` +
    `a Google review would mean a lot: ${reviewLink}`,

  electrical: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, everything running right electrically? ` +
    `If ${businessName} tracked it down for you, a quick review goes a long way: ${reviewLink}`,

  cooling_system: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, hope the cooling system is holding strong. ` +
    `If ${businessName} kept you from overheating, a review would be great: ${reviewLink}`,

  transmission: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, shifting smooth? Transmission work is no small job — ` +
    `if ${businessName} took care of you, a review means everything: ${reviewLink}`,

  suspension: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, how is the ride feeling? ` +
    `If ${businessName} got the suspension right, would you drop us a quick review? ${reviewLink}`,

  exhaust: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, running quiet now? If ${businessName} sorted the exhaust, ` +
    `a Google review would really help us out: ${reviewLink}`,

  tune_up: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, feeling that fresh tune-up? ` +
    `If ${businessName} got the engine humming again, a quick review would mean a lot: ${reviewLink}`,

  inspection: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, thanks for trusting ${businessName} with the inspection. ` +
    `If we gave you peace of mind, would you share a quick review? ${reviewLink}`,

  towing: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, glad ${businessName} could get you moving again. ` +
    `If we took good care of you, a Google review would mean a lot: ${reviewLink}`,

  mobile_service: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, thanks for having ${businessName} come out to you. ` +
    `If everything is running right, a quick Google review helps us a ton: ${reviewLink}`,

  ac_service: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, staying cool now? If ${businessName} got your A/C blowing cold, ` +
    `a quick Google review would really help: ${reviewLink}`,

  coolant_flush: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, fresh coolant in and running cool? ` +
    `If ${businessName} took care of you, a Google review would mean a lot: ${reviewLink}`,

  power_steering: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, steering feeling smooth again? ` +
    `If ${businessName} got you handling right, would you drop a quick review? ${reviewLink}`,

  fuel_system: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, running cleaner now? If the fuel system service at ` +
    `${businessName} did the trick, a Google review would really help: ${reviewLink}`,

  // Heavy duty work the Suite templates never covered — an HD shop closing a
  // DOT inspection or a reefer call should not fall through to the generic copy.
  dot_inspection: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, inspection paperwork is done and you are legal to roll. ` +
    `If ${businessName} turned it around fast, a Google review helps other fleets find us: ${reviewLink}`,

  trailer_service: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, trailer back in service? If ${businessName} got you loaded ` +
    `and moving, a quick Google review would mean a lot: ${reviewLink}`,

  reefer_service: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, holding temp again? If ${businessName} got the reefer sorted, ` +
    `a Google review really helps us: ${reviewLink}`,

  default: ({ customerFirstName, businessName, reviewLink }) =>
    `Hi ${customerFirstName}, thanks for choosing ${businessName}. ` +
    `If everything is running right, a quick Google review would really help: ${reviewLink}`,
}

/**
 * Exact-phrase routing, ported from the Suite's SERVICE_TYPE_MAP. A shop job
 * has no `service_type` column — the text here is the job description or
 * complaint the service writer typed — so this map is the fast path and
 * KEYWORD_RULES below is what actually catches most real jobs.
 */
const SERVICE_TYPE_MAP: Record<string, string> = {
  oil_change:               'oil_change',
  'oil change':             'oil_change',
  brakes:                   'brake_service',
  brake_service:            'brake_service',
  'brake service':          'brake_service',
  brake_repair:             'brake_service',
  diagnostic:               'diagnostic',
  diagnostics:              'diagnostic',
  'engine diagnostic':      'diagnostic',
  tires:                    'tire_service',
  tire_service:             'tire_service',
  'tire service':           'tire_service',
  'tire rotation':          'tire_service',
  'tire replacement':       'tire_service',
  battery:                  'battery',
  'battery replacement':    'battery',
  electrical:               'electrical',
  'electrical repair':      'electrical',
  cooling:                  'cooling_system',
  'cooling system':         'cooling_system',
  radiator:                 'cooling_system',
  'coolant flush':          'coolant_flush',
  transmission:             'transmission',
  'transmission service':   'transmission',
  suspension:               'suspension',
  'suspension repair':      'suspension',
  exhaust:                  'exhaust',
  'exhaust repair':         'exhaust',
  tune_up:                  'tune_up',
  'tune up':                'tune_up',
  'tune-up':                'tune_up',
  inspection:               'inspection',
  'safety inspection':      'inspection',
  'pre-purchase inspection': 'inspection',
  'dot inspection':         'dot_inspection',
  'annual inspection':      'dot_inspection',
  towing:                   'towing',
  'mobile service':         'mobile_service',
  'a/c':                    'ac_service',
  ac:                       'ac_service',
  'a/c service':            'ac_service',
  'ac service':             'ac_service',
  'air conditioning':       'ac_service',
  'power steering':         'power_steering',
  'fuel system':            'fuel_system',
  other:                    'default',
}

/**
 * First rule whose keywords appear in the job text wins, so order matters:
 * narrower categories sit above broader ones. "Front brake rotors and DOT
 * inspection" is a brake job with paperwork, not an inspection.
 */
const KEYWORD_RULES: Array<[string, RegExp]> = [
  ['oil_change',      /\boil change\b|\blof\b|lube.{0,10}oil|\boil\b.{0,12}\bfilter\b/],
  ['brake_service',   /\bbrake|\brotor|\bcaliper|\bpads?\b|air ?brake|slack adjuster/],
  ['tire_service',    /\btire|\bwheel\b|rotation|balance|\btpms\b|alignment|retread/],
  ['transmission',    /transmission|clutch|differential|drivetrain|\bdiff\b|\bpto\b/],
  ['cooling_system',  /radiator|coolant|overheat|water pump|thermostat/],
  ['ac_service',      /\ba\/?c\b|air condition|refrigerant|\b134a\b|\b1234yf\b/],
  ['reefer_service',  /reefer|thermo ?king|carrier transicold|refrigeration unit/],
  ['dot_inspection',  /\bdot\b|annual inspection|\bcvsa\b|\bbit\b inspection/],
  ['trailer_service', /trailer|\bkingpin\b|landing gear|\babs\b.{0,10}trailer/],
  ['battery',         /batter|\balternator\b|starter motor|no.?start/],
  ['electrical',      /electric|wiring|harness|short circuit|\bfuse\b|\blights?\b/],
  ['exhaust',         /exhaust|muffler|\bdpf\b|\bdef\b|aftertreatment|\begr\b/],
  ['suspension',      /suspension|\bstruts?\b|\bshocks?\b|leaf spring|air bag|ride height/],
  ['power_steering',  /power steering|steering gear|\btie rod\b/],
  ['fuel_system',     /fuel|injector|\bhpfp\b|fuel pump/],
  ['tune_up',         /tune.?up|spark plug|ignition coil/],
  ['towing',          /\btow\b|towing|roadside/],
  ['mobile_service',  /mobile|on.?site|road call/],
  ['inspection',      /inspect|pre.?purchase|\bpm\b service|preventive maintenance/],
  ['diagnostic',      /diagnos|check engine|fault code|scan tool|\bdtc\b/],
]

/** Which template body a job's free text maps onto. Exported for the preview. */
export function templateKeyFor(serviceText: string | null | undefined): string {
  const text = (serviceText ?? '').trim().toLowerCase()
  if (!text) return 'default'

  const exact = SERVICE_TYPE_MAP[text]
  if (exact) return exact

  for (const [key, pattern] of KEYWORD_RULES) {
    if (pattern.test(text)) return key
  }
  return 'default'
}

/** Renders a shop-authored template. Unknown placeholders are left untouched. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  let body = template
    .replaceAll('{first_name}', vars.customerFirstName)
    .replaceAll('{shop}', vars.businessName)

  // A shop can delete {link} from the textarea, and a review request with no
  // review link is worse than no text at all. Append it rather than send a
  // dead-end message.
  body = body.includes('{link}')
    ? body.replaceAll('{link}', vars.reviewLink)
    : `${body.trimEnd()} ${vars.reviewLink}`

  return body.trim()
}

/** Adds the opt-out notice unless the body already carries a STOP instruction. */
export function appendOptOut(body: string): string {
  return /\bstop\b/i.test(body) ? body : `${body.trimEnd()} ${OPT_OUT_NOTICE}`
}

/**
 * The one function that produces an outbound body. A shop's own template wins;
 * otherwise the job text picks a canned one. Opt-out language is applied here so
 * no caller can produce a compliant-looking message without it.
 */
export function buildSmsBody({
  serviceText,
  customTemplate,
  vars,
}: {
  serviceText: string | null | undefined
  customTemplate: string | null | undefined
  vars: TemplateVars
}): string {
  const custom = customTemplate?.trim()
  if (custom) return appendOptOut(renderTemplate(custom, vars))

  const key = templateKeyFor(serviceText)
  const fn = templates[key] ?? templates.default
  return appendOptOut(fn(vars))
}

/** First name from a customer record, or a neutral fallback. */
export function firstNameOf(
  customer: { first_name?: string | null; company?: string | null } | null,
): string {
  const given = customer?.first_name?.trim().split(/\s+/)[0]
  if (given) return given
  const company = customer?.company?.trim()
  return company || 'there'
}

/**
 * Carrier segment count for the preview. GSM-7 gives 160 for a single segment
 * and 153 per segment once concatenated; a body containing anything outside
 * the basic set drops to UCS-2 at 70/67. This is an estimate for the UI, not a
 * billing figure.
 */
export function estimateSegments(body: string): number {
  const unicode = [...body].some((ch) => ch.charCodeAt(0) > 127)
  const single = unicode ? 70 : 160
  const multi = unicode ? 67 : 153
  if (body.length <= single) return 1
  return Math.ceil(body.length / multi)
}

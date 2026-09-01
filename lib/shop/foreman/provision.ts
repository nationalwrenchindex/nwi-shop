// =====================================================================
// THIS MODULE DELIBERATELY DOES NOT BUY A PHONE NUMBER.
//
// The Suite's version (src/lib/foreman/provision.ts) searches Twilio for an
// available local number and then POSTs to IncomingPhoneNumbers.json to
// PURCHASE it — a real charge on a live Twilio account, plus a recurring
// monthly cost per subscriber, plus a Vapi import call. It also hardcodes the
// webhook URL to tools.nationalwrenchindex.com.
//
// None of that can be reproduced safely here:
//   - No VAPI_API_KEY exists in either project, so nothing about the Vapi half
//     could be tested end to end.
//   - Buying a number is an irreversible billing event. Untested code that
//     spends money on every call is not something to ship.
//
// So this module goes exactly as far as it safely can: it CHECKS whether the
// preconditions are met and returns the manual steps. It never calls Twilio's
// purchase endpoint and never calls Vapi. A human buys the number in the
// Twilio console, imports it into Vapi, and pastes the resulting values into
// shop_foreman_settings.
// =====================================================================

export interface ProvisionPreflight {
  /** True only when a human could complete provisioning right now. */
  ready:          boolean
  /** Env vars that are absent. Provisioning cannot proceed while non-empty. */
  missing:        string[]
  /**
   * Always true. Nothing in this repository has ever completed a provisioning
   * run, because no Vapi credentials have ever existed for it. Treat every step
   * below as untested.
   */
  unverified:     true
  /** The URL a human must register as the Vapi Server URL. */
  serverUrl:      string | null
  /** Ordered manual steps. There is no automated path. */
  manualSteps:    string[]
  message:        string
}

const REQUIRED_ENV = ['VAPI_API_KEY', 'TWILIO_ACCOUNT_SID', 'VAPI_ASSISTANT_ID', 'VAPI_WEBHOOK_SECRET']

function serverUrl(): string | null {
  // Never hardcode a domain — the Suite hardcoded tools.nationalwrenchindex.com
  // in two separate files, which silently pointed every deployment's webhook at
  // one production host.
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '')
  return base ? `${base}/api/vapi/webhook` : null
}

/**
 * Reports whether Foreman provisioning could be completed, and what a person
 * must do by hand. **Refuses unless `confirm: true` is passed explicitly** and
 * both `VAPI_API_KEY` and `TWILIO_ACCOUNT_SID` are set — the confirm flag exists
 * so this can never be triggered by a stray call from a UI handler or a webhook.
 *
 * Even when it returns `ready: true`, NOTHING HAS BEEN PROVISIONED and nothing
 * has been verified. It buys no number, imports no number, and creates no
 * assistant. The steps it returns are for a human to perform.
 */
export function foremanProvisioningPreflight(
  opts: { confirm?: boolean } = {},
): ProvisionPreflight {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name])
  const url = serverUrl()

  const manualSteps = [
    'Create a Vapi account and generate a private API key. Set it as VAPI_API_KEY.',
    'In the Vapi dashboard, hand-build one master Foreman assistant: paste FOREMAN_PROMPT_TEMPLATE from lib/shop/foreman/prompt.ts as its system prompt, pick a voice and a transcriber, and add the check_availability and book_appointment tools using FOREMAN_TOOL_SCHEMAS from the same file.',
    'Copy that assistant’s id into VAPI_ASSISTANT_ID.',
    `Set the assistant’s Server URL to ${url ?? '<your deployment>/api/vapi/webhook'} and its Server URL Secret to a value you also set as VAPI_WEBHOOK_SECRET.`,
    'Fund a Twilio account and buy a local number in the Twilio console. This is a real, recurring charge and is deliberately not automated here.',
    'Import that number into Vapi and attach it to the Foreman assistant.',
    'Write the number (E.164, e.g. +13365550100) into shop_foreman_settings.phone_number and the Vapi phone-number id into shop_foreman_settings.vapi_phone_number_id for the shop.',
    'Add /api/vapi to PUBLIC_PREFIXES in proxy.ts. It currently reaches the handler only because it matches neither the public nor the protected list — declare it explicitly so widening the protected prefixes later cannot silently 401 every call.',
    'Place one live test call and confirm a shop_foreman_calls row appears.',
  ]

  if (!opts.confirm) {
    return {
      ready:       false,
      missing,
      unverified:  true,
      serverUrl:   url,
      manualSteps,
      message:
        'Refused: provisioning is a manual, billable process. Nothing runs without an explicit confirm.',
    }
  }

  if (missing.length > 0) {
    return {
      ready:      false,
      missing,
      unverified: true,
      serverUrl:  url,
      manualSteps,
      message: `Refused: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. Foreman cannot be provisioned.`,
    }
  }

  return {
    ready:      true,
    missing:    [],
    unverified: true,
    serverUrl:  url,
    manualSteps,
    message:
      'Preconditions are present, but nothing was provisioned. This code does not purchase phone numbers or create assistants — a person must complete the steps above, and none of them have ever been verified against a live Vapi account.',
  }
}

// SMS for NWI Shop. Raw fetch against the Twilio REST API using the registered
// 10DLC Messaging Service, so every message routes through the verified campaign.
//
// sendShopSms never throws — a customer text failing must never fail the job
// update that triggered it. sendShopSmsResult is the same send path but reports
// success to the caller, for batch senders that need retry logic.

const MESSAGING_SERVICE_SID = 'MGbc3ba6d2d67f6d2b5cffaa62df481e36'

const TWILIO_API = 'https://api.twilio.com/2010-04-01/Accounts'

/** Normalizes a US phone number to E.164. */
function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`
}

interface TwilioError {
  message?: string
  code?: number
}

async function post(
  sid: string,
  token: string,
  to: string,
  body: string,
): Promise<Response> {
  const basicAuth = Buffer.from(`${sid}:${token}`).toString('base64')
  return fetch(`${TWILIO_API}/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      MessagingServiceSid: MESSAGING_SERVICE_SID,
      To: toE164(to),
      Body: body,
    }).toString(),
  })
}

/** Fire-and-forget send. Logs on failure, never throws. */
export async function sendShopSms({
  to,
  body,
}: {
  to: string
  body: string
}): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN

  if (!sid || !token) {
    console.warn('[nwi-shop-sms] Twilio credentials not configured — skipping')
    return
  }

  try {
    const res = await post(sid, token, to, body)
    if (!res.ok) {
      const data = (await res.json()) as TwilioError
      console.error(
        '[nwi-shop-sms] Twilio error (HTTP',
        res.status,
        'code',
        data.code,
        '):',
        data.message,
      )
    }
  } catch (err) {
    console.error(
      '[nwi-shop-sms] fetch error:',
      err instanceof Error ? err.message : String(err),
    )
  }
}

/** Same send path, but surfaces the outcome so batch callers can retry. */
export async function sendShopSmsResult({
  to,
  body,
}: {
  to: string
  body: string
}): Promise<{ success: boolean; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN

  if (!sid || !token) {
    return { success: false, error: 'Twilio credentials not configured' }
  }

  try {
    const res = await post(sid, token, to, body)

    if (!res.ok) {
      const data = (await res.json()) as TwilioError
      const msg = `HTTP ${res.status} code ${data.code}: ${data.message}`
      console.error('[nwi-shop-sms] Twilio error:', msg)
      return { success: false, error: msg }
    }

    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[nwi-shop-sms] fetch error:', msg)
    return { success: false, error: msg }
  }
}

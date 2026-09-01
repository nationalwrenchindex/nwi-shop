// Authentication for the Vapi server webhook (/api/vapi/webhook).
//
// Ported from national_wrench_index/src/lib/vapi/verify-signature.ts with its
// security posture kept exactly as-is:
//
// Vapi's documented default for server webhooks is a SHARED SECRET, not an HMAC:
// the value typed into "Server URL Secret" in the Vapi dashboard is echoed back
// verbatim in an `X-Vapi-Secret` header on every request. An HMAC-only check
// would 401 every genuine Vapi call.
//
// Some deployments are instead configured to send an HMAC-SHA256 of the raw
// request body, so both paths are supported and either one passing is enough.
// The HMAC path is why the caller must hand us the RAW body text: re-serializing
// parsed JSON reorders keys and changes whitespace, so the digest would never
// match.
//
// FAIL CLOSED. An unset VAPI_WEBHOOK_SECRET rejects everything. Treating "no
// secret" as "allow everything" is exactly the hole this module closes: anyone
// who learned the URL could post fabricated call events and create real jobs and
// real SMS against a shop's account. A misconfigured deploy that rejects real
// calls is loud and fixable; one that accepts forged calls is silent and not.

import crypto from 'node:crypto'

/** Header Vapi sends the dashboard's "Server URL Secret" in, verbatim. */
const SHARED_SECRET_HEADER = 'x-vapi-secret'

/** Header used when the deployment is configured to sign the body instead. */
const SIGNATURE_HEADER = 'x-vapi-signature'

export type VapiAuthResult =
  | { ok: true;  via: 'shared-secret' | 'hmac' }
  | { ok: false; reason: 'secret-not-configured' | 'no-credential' | 'bad-credential' }

/**
 * Verify an inbound Vapi webhook request.
 *
 * `rawBody` must be the exact bytes Vapi sent, read with `request.text()` before
 * any JSON parsing — the body can only be consumed once, and the HMAC path needs
 * it byte for byte.
 */
export function verifyVapiRequest(headers: Headers, rawBody: string): VapiAuthResult {
  const secret = process.env.VAPI_WEBHOOK_SECRET
  if (!secret) return { ok: false, reason: 'secret-not-configured' }

  // Headers.get() is case-insensitive per the fetch spec, so `X-Vapi-Secret` and
  // `x-vapi-secret` both resolve here.
  const presentedSecret = headers.get(SHARED_SECRET_HEADER)
  const presentedSig = headers.get(SIGNATURE_HEADER)

  if (!presentedSecret && !presentedSig) return { ok: false, reason: 'no-credential' }

  if (presentedSecret && constantTimeEquals(presentedSecret, secret)) {
    return { ok: true, via: 'shared-secret' }
  }

  if (presentedSig && matchesHmac(presentedSig, rawBody, secret)) {
    return { ok: true, via: 'hmac' }
  }

  return { ok: false, reason: 'bad-credential' }
}

/**
 * Compare the presented signature against the HMAC-SHA256 of the raw body.
 *
 * Both hex and base64 are accepted because Vapi has shipped both encodings and
 * the header carries no encoding tag; trying both costs one extra constant-time
 * compare and removes a class of "works in one region, 401s in another" bugs.
 */
function matchesHmac(presented: string, rawBody: string, secret: string): boolean {
  // Some senders prefix the digest with the algorithm (GitHub-style `sha256=…`).
  const candidate = presented.trim().replace(/^sha256=/i, '')
  if (!candidate) return false

  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest()

  return (
    constantTimeEquals(candidate, digest.toString('hex')) ||
    constantTimeEquals(candidate, digest.toString('base64'))
  )
}

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws when the two buffers differ in length, and an early
 * length check would leak the length of the real secret through timing and
 * control flow. Hashing both sides to a fixed 32-byte digest first makes every
 * comparison the same width, so no input can trigger the throw and the only
 * thing observable is equality.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest()
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest()
  return crypto.timingSafeEqual(ha, hb)
}

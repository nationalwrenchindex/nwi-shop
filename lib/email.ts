// Transactional + alert email for NWI Shop, via Resend. Every export swallows its
// own failures: an email that does not send must never fail the request that
// triggered it.

import { Resend } from 'resend'
import { APP_URL, PRODUCT_NAME, SUPPORT_EMAIL } from '@/lib/branding'

const FROM = `${PRODUCT_NAME} <onboarding@resend.dev>`
const FOUNDER_INBOX = 'nwisuite@nationalwrenchindex.com'

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[nwi-shop-email] RESEND_API_KEY not set — skipping send')
    return null
  }
  return new Resend(apiKey)
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

/** Escapes interpolated values before they go into an HTML email body. */
export function esc(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c)
}

/** Wraps body HTML in the shared NWI Shop email shell. */
function shell(heading: string, bodyHtml: string): string {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;line-height:1.6;">
      <div style="background:#0f172a;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;">
        <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;">${esc(PRODUCT_NAME)}</div>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:24px;">
        <h2 style="margin:0 0 16px;font-size:20px;color:#0f172a;">${esc(heading)}</h2>
        ${bodyHtml}
        <p style="margin-top:28px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
          ${esc(PRODUCT_NAME)} &middot; <a href="${APP_URL}" style="color:#475569;">${esc(APP_URL)}</a><br/>
          Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:#475569;">${esc(SUPPORT_EMAIL)}</a>
        </p>
      </div>
    </div>
  `
}

/** Low-level send. Returns false instead of throwing on any failure. */
export async function sendEmail({
  to,
  subject,
  html,
  replyTo,
}: {
  to: string | string[]
  subject: string
  html: string
  replyTo?: string
}): Promise<boolean> {
  const resend = getResend()
  if (!resend) return false
  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    })
    if (error) {
      console.error('[nwi-shop-email] send failed:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error(
      '[nwi-shop-email] send threw:',
      err instanceof Error ? err.message : String(err),
    )
    return false
  }
}

/** Branded send — same as sendEmail but wrapped in the NWI Shop shell. */
export async function sendShopEmail({
  to,
  subject,
  heading,
  bodyHtml,
  replyTo,
}: {
  to: string | string[]
  subject: string
  heading: string
  bodyHtml: string
  replyTo?: string
}): Promise<boolean> {
  return sendEmail({ to, subject, html: shell(heading, bodyHtml), replyTo })
}

/** Internal heads-up to the founders. Never surfaced to a customer. */
export async function sendFounderAlert({
  subject,
  html,
}: {
  subject: string
  html: string
}): Promise<boolean> {
  return sendEmail({ to: FOUNDER_INBOX, subject: `[${PRODUCT_NAME}] ${subject}`, html })
}

/** Fires when a shop finishes checkout. */
export async function sendNewShopAlert({
  businessName,
  email,
  tier,
  amountDollars,
}: {
  businessName: string
  email: string
  tier: string
  amountDollars: number | null
}): Promise<boolean> {
  const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
  const amount = amountDollars != null ? `$${amountDollars}/mo` : '—'
  const row = (label: string, value: string) =>
    `<tr><td style="color:#64748b;padding:6px 0;width:120px;">${esc(label)}</td>` +
    `<td style="padding:6px 0;font-weight:600;">${esc(value)}</td></tr>`

  return sendFounderAlert({
    subject: `New shop — ${tier} — ${email}`,
    html: shell(
      'New shop signed up',
      `<table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${row('Business', businessName)}
        ${row('Email', email)}
        ${row('Tier', tier)}
        ${row('Amount', amount)}
        ${row('Time', when)}
      </table>`,
    ),
  })
}

/** Invites a newly added tech to claim their login. */
export async function sendTechInvite({
  to,
  firstName,
  businessName,
  roleLabel,
}: {
  to: string
  firstName: string
  businessName: string
  roleLabel: string
}): Promise<boolean> {
  return sendShopEmail({
    to,
    subject: `${businessName} added you on ${PRODUCT_NAME}`,
    heading: `Welcome to ${businessName}`,
    bodyHtml: `
      <p>Hi ${esc(firstName)},</p>
      <p>You've been added to <strong>${esc(businessName)}</strong> on ${esc(PRODUCT_NAME)} as
      <strong>${esc(roleLabel)}</strong>. Sign in with this email address to see your job board and clock in.</p>
      <p style="margin:24px 0;">
        <a href="${APP_URL}/login"
           style="display:inline-block;background:#0f172a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">
          Sign in to ${esc(PRODUCT_NAME)}
        </a>
      </p>
    `,
  })
}

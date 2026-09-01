'use client'

// Every action that can be taken on an invoice, in one bar: convert, print,
// send, copy the public link, mark paid.
//
// This component holds no invoice data and imports nothing from
// `@/lib/shop/invoice` — it takes only the flags it needs to decide what to
// enable. That keeps the server-only module (Web Crypto, Supabase queries) off
// the client bundle, and it means nothing here can reconstruct a cost figure.
//
// Delivery outcomes are reported per channel because a send can half-succeed:
// the email lands and the text bounces. The API never throws on a send failure,
// so the UI has to be the thing that says which half worked.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface ChannelResult {
  attempted: boolean
  sent:      boolean
  to:        string | null
  reason:    string | null
}

interface SendResponse {
  ok?:      boolean
  email?:   ChannelResult
  sms?:     ChannelResult
  warning?: string | null
  error?:   string
}

function describe(channel: string, result: ChannelResult | undefined): string | null {
  if (!result) return null
  if (result.sent) return `${channel} sent to ${result.to ?? 'the customer'}.`
  if (!result.attempted) return `${channel} skipped - ${result.reason ?? 'not requested.'}`
  return `${channel} failed - ${result.reason ?? 'unknown error.'}`
}

export default function InvoiceActions({
  jobId,
  converted,
  canConvert,
  hasLineItems,
  paid,
  publicUrl,
  sentAt,
  customerEmail,
  customerPhone,
  noEmail,
  noSms,
}: {
  jobId:         string
  converted:     boolean
  canConvert:    boolean
  hasLineItems:  boolean
  paid:          boolean
  publicUrl:     string | null
  sentAt:        string | null
  customerEmail: string | null
  customerPhone: string | null
  noEmail:       boolean
  noSms:         boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'convert' | 'send' | 'paid'>(null)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  const working = busy !== null || pending

  async function call(
    action: 'convert' | 'send' | 'paid',
    url: string,
    init: RequestInit,
    onOk: (payload: SendResponse) => string[],
  ) {
    setBusy(action)
    setError(null)
    setNotes([])
    try {
      const res = await fetch(url, init)
      const payload = (await res.json().catch(() => null)) as SendResponse | null
      if (!res.ok) {
        setError(payload?.error ?? 'That did not work. Nothing was changed.')
        return
      }
      setNotes(onOk(payload ?? {}))
      startTransition(() => router.refresh())
    } catch {
      setError('Network error - nothing was changed.')
    } finally {
      setBusy(null)
    }
  }

  const convert = () =>
    call(
      'convert',
      `/api/shop/jobs/${jobId}/invoice`,
      { method: 'POST' },
      (payload) => (payload.warning ? [payload.warning] : ['Invoice created.']),
    )

  const send = () =>
    call(
      'send',
      `/api/shop/jobs/${jobId}/invoice/send`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: true, sms: true }),
      },
      (payload) =>
        [
          describe('Email', payload.email),
          describe('Text', payload.sms),
          payload.warning ?? null,
        ].filter((line): line is string => !!line),
    )

  const setPaid = (next: boolean) =>
    call(
      'paid',
      `/api/shop/jobs/${jobId}/invoice`,
      {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ paid: next }),
      },
      () => [next ? 'Marked paid.' : 'Payment cleared.'],
    )

  async function copyLink() {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy - select the link and copy it by hand.')
    }
  }

  // A send with nowhere to go is a dead button; say why instead.
  const emailBlocked = noEmail || !customerEmail
  const smsBlocked = noSms || !customerPhone
  const sendBlocked = emailBlocked && smsBlocked

  return (
    <section className="nwi-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        {!converted && (
          <button
            type="button"
            onClick={convert}
            disabled={!canConvert || !hasLineItems || working}
            title={
              !hasLineItems
                ? 'Add labor or parts to this job first.'
                : !canConvert
                  ? 'Finish the work order before invoicing it.'
                  : undefined
            }
            className="nwi-btn nwi-btn-primary"
          >
            {busy === 'convert' ? 'Creating...' : 'Create invoice'}
          </button>
        )}

        <a
          href={`/api/shop/jobs/${jobId}/invoice/print`}
          target="_blank"
          rel="noopener noreferrer"
          className="nwi-btn nwi-btn-secondary"
        >
          Print / PDF
        </a>

        {converted && (
          <button
            type="button"
            onClick={send}
            disabled={sendBlocked || working}
            title={sendBlocked ? 'This customer has no reachable email or phone.' : undefined}
            className="nwi-btn nwi-btn-secondary"
          >
            {busy === 'send' ? 'Sending...' : sentAt ? 'Send again' : 'Send to customer'}
          </button>
        )}

        {converted && publicUrl && (
          <button type="button" onClick={copyLink} className="nwi-btn nwi-btn-secondary">
            {copied ? 'Link copied' : 'Copy customer link'}
          </button>
        )}

        {converted && (
          <button
            type="button"
            onClick={() => setPaid(!paid)}
            disabled={working}
            className={`nwi-btn ${paid ? 'nwi-btn-danger' : 'nwi-btn-primary'}`}
          >
            {busy === 'paid' ? 'Saving...' : paid ? 'Mark unpaid' : 'Mark paid'}
          </button>
        )}
      </div>

      {sendBlocked && converted && (
        <p className="mt-3 text-xs font-semibold text-slate-600">
          {noEmail || noSms
            ? 'This customer has asked not to be contacted on the channels on file. Print the invoice or copy the link instead.'
            : 'No email address or phone number on this customer. Print the invoice or copy the link instead.'}
        </p>
      )}

      {error && (
        <p className="mt-3 text-sm font-semibold text-red-700" role="alert">
          {error}
        </p>
      )}

      {notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-slate-700">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

'use client'

// The review-request settings form, with a live preview of the exact text the
// customer receives. The preview calls buildSmsBody — the same function the cron
// sender calls — rather than a lookalike, so what a manager approves here is
// what actually goes out, opt-out line and all.

import { useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  buildSmsBody,
  estimateSegments,
  DEFAULT_MESSAGE_TEMPLATE,
  TEMPLATE_PLACEHOLDER_HELP,
} from '@/lib/shop/torquewrench/templates'
import {
  MAX_DELAY_MINUTES,
  MIN_DELAY_MINUTES,
  type ShopReviewSettings,
} from '@/lib/shop/torquewrench/types'

/** What the preview pretends the job was, so the canned templates have input. */
const SAMPLE_SERVICE_TEXT = 'Front brake pads and rotors'
const SAMPLE_FIRST_NAME = 'Dana'

async function readError(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json()
    if (body && typeof body === 'object' && 'error' in body) {
      const message = (body as { error?: unknown }).error
      if (typeof message === 'string') return message
    }
  } catch {
    // Fall through to the generic message.
  }
  return 'Something went wrong. Try again.'
}

export default function SettingsForm({
  initialSettings,
  businessName,
  sampleLink,
  disabledReason,
}: {
  initialSettings: ShopReviewSettings
  businessName: string
  /** An example /r/<token> link built on the server, so the preview is honest. */
  sampleLink: string
  /** Non-null when the tables are missing — the form is read-only. */
  disabledReason: string | null
}) {
  const router = useRouter()

  const [isEnabled, setIsEnabled] = useState(initialSettings.is_enabled)
  const [placeId, setPlaceId] = useState(initialSettings.google_place_id ?? '')
  const [delay, setDelay] = useState(String(initialSettings.delay_minutes ?? 60))
  const [recoveryPhone, setRecoveryPhone] = useState(
    initialSettings.service_recovery_phone ?? '',
  )
  const [template, setTemplate] = useState(initialSettings.message_template ?? '')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const locked = disabledReason !== null

  const preview = useMemo(
    () =>
      buildSmsBody({
        serviceText: SAMPLE_SERVICE_TEXT,
        customTemplate: template.trim() || null,
        vars: {
          customerFirstName: SAMPLE_FIRST_NAME,
          businessName: businessName || 'our shop',
          reviewLink: sampleLink,
        },
      }),
    [template, businessName, sampleLink],
  )

  const segments = estimateSegments(preview)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || locked) return

    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/shop/torquewrench', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_enabled: isEnabled,
          google_place_id: placeId.trim() || null,
          service_recovery_phone: recoveryPhone.trim() || null,
          delay_minutes: Number(delay),
          message_template: template.trim() || null,
        }),
      })
      if (!res.ok) {
        setError(await readError(res))
        return
      }
      setSaved(true)
      router.refresh()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="nwi-card space-y-6 p-5 sm:p-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Review requests</h2>
        <p className="mt-1 text-sm text-slate-500">
          One text goes out per completed job, after the delay you set below.
        </p>
      </div>

      {locked ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {disabledReason}
        </p>
      ) : null}

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 rounded border-slate-300"
          checked={isEnabled}
          disabled={locked}
          onChange={(e) => setIsEnabled(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-semibold text-slate-900">
            Send review requests automatically
          </span>
          <span className="block text-sm text-slate-500">
            While this is off, completed jobs are not queued and nothing is texted.
          </span>
        </span>
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="nwi-label" htmlFor="tw-place-id">
            Google Place ID
          </label>
          <input
            id="tw-place-id"
            className="nwi-input"
            value={placeId}
            disabled={locked}
            placeholder="ChIJ..."
            onChange={(e) => setPlaceId(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            Required. Without it the review link has nowhere to send the customer,
            so requests are never sent.
          </p>
        </div>

        <div>
          <label className="nwi-label" htmlFor="tw-delay">
            Delay after the job is completed (minutes)
          </label>
          <input
            id="tw-delay"
            className="nwi-input"
            type="number"
            inputMode="numeric"
            min={MIN_DELAY_MINUTES}
            max={MAX_DELAY_MINUTES}
            value={delay}
            disabled={locked}
            onChange={(e) => setDelay(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            60 is a good default. The clock starts when the job is marked complete,
            not when the customer picks up.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="nwi-label" htmlFor="tw-recovery">
            Service recovery phone
          </label>
          <input
            id="tw-recovery"
            className="nwi-input"
            type="tel"
            value={recoveryPhone}
            disabled={locked}
            placeholder="Optional"
            onChange={(e) => setRecoveryPhone(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            Where an unhappy reply is routed, so a low rating reaches a manager
            instead of Google.
          </p>
        </div>
      </div>

      <div>
        <label className="nwi-label" htmlFor="tw-template">
          Message
        </label>
        <textarea
          id="tw-template"
          className="nwi-input min-h-28"
          rows={4}
          value={template}
          disabled={locked}
          placeholder={DEFAULT_MESSAGE_TEMPLATE}
          onChange={(e) => setTemplate(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">
          Leave this blank and each text is written for the work that was done —
          a brake job reads differently from an oil change. Fill it in to use one
          message for everything.
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(TEMPLATE_PLACEHOLDER_HELP).map(([token, help]) => (
            <li key={token} className="text-xs text-slate-500">
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-700">
                {token}
              </code>{' '}
              {help}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="nwi-label mb-0">Preview</span>
          <span className="text-xs text-slate-500">
            {preview.length} characters &middot; {segments} SMS segment
            {segments === 1 ? '' : 's'}
          </span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
          {preview}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Sample job: {SAMPLE_SERVICE_TEXT}. The opt-out line is added to every
          message and cannot be removed.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Settings saved.
        </p>
      ) : null}

      <div>
        <button type="submit" className="nwi-btn nwi-btn-primary" disabled={busy || locked}>
          {busy ? 'Saving...' : 'Save settings'}
        </button>
      </div>
    </form>
  )
}

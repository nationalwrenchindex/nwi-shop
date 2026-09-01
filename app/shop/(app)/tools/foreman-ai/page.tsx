// /shop/tools/foreman-ai — settings, call history, and an honest setup checklist.
//
// requireFeature() is the first statement: `foreman_ai` is every shop type at
// the elite tier.
//
// READ THIS BEFORE CHANGING THE COPY ON THIS PAGE.
// Foreman does not work in this deployment and cannot be made to work from
// inside this app. The assistant itself lives in the Vapi dashboard, no Vapi
// credentials exist, and the phone number has to be bought from Twilio by a
// human. The checklist below is not marketing — it is the actual list of things
// that are not done. Do not soften it, and do not render sample calls: a
// fabricated transcript on this page is a fabricated record of a conversation
// with a real customer.

import type { Metadata } from 'next'
import { requireFeature } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { FEATURE_LABELS } from '@/lib/permissions'
import PageHeader from '@/components/page-header'
import {
  MISSING_TABLE_MESSAGE,
  loadForemanCalls,
  loadForemanSettings,
  defaultSettings,
} from '@/lib/shop/foreman/settings'
import { FOREMAN_PROMPT_TEMPLATE } from '@/lib/shop/foreman/prompt'
import { foremanProvisioningPreflight } from '@/lib/shop/foreman/provision'
import ForemanSettingsForm from './_components/foreman-settings-form'

export const metadata: Metadata = { title: FEATURE_LABELS.foreman_ai }

/** Presence only — no value from process.env is ever rendered. */
function envStatus() {
  return [
    { name: 'VAPI_API_KEY',        set: Boolean(process.env.VAPI_API_KEY),        why: 'Lets a human manage the assistant and phone numbers from the Vapi API.' },
    { name: 'VAPI_ASSISTANT_ID',   set: Boolean(process.env.VAPI_ASSISTANT_ID),   why: 'The id of the master assistant you build by hand in the Vapi dashboard. Without it, calls get a "system updating" message.' },
    { name: 'VAPI_WEBHOOK_SECRET', set: Boolean(process.env.VAPI_WEBHOOK_SECRET), why: 'The Server URL Secret. The webhook rejects every request while this is unset — on purpose.' },
    { name: 'TWILIO_ACCOUNT_SID',  set: Boolean(process.env.TWILIO_ACCOUNT_SID),  why: 'Needed for the phone number and for the confirmation texts.' },
  ]
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default async function ForemanAiPage() {
  const ctx = await requireFeature('foreman_ai')

  const supabase = await createClient()
  const [settingsResult, callsResult] = await Promise.all([
    loadForemanSettings(supabase, ctx.shop.id),
    loadForemanCalls(supabase, ctx.shop.id),
  ])

  const tableMissing =
    (!settingsResult.ok && settingsResult.reason === 'missing_table') ||
    callsResult.missingTable

  const settings = settingsResult.ok ? settingsResult.settings : defaultSettings(ctx.shop.id)
  const preflight = foremanProvisioningPreflight()
  const env = envStatus()
  const blockers = env.filter((entry) => !entry.set)

  const live = Boolean(
    settings.is_enabled &&
      settings.phone_number &&
      env.every((entry) => entry.set),
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title={FEATURE_LABELS.foreman_ai}
        subtitle="An AI receptionist that answers the shop line, quotes labor time, and books work into your job board."
      />

      {/* Not .nwi-card — that rule is unlayered CSS and beats Tailwind's layered
          color utilities, so a colored panel spells its own colors out. */}
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-base font-semibold text-amber-900">
          {live ? 'Configured — but never verified' : 'Not answering calls yet'}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
          Foreman is not something this app can switch on by itself. The
          assistant that actually talks to your callers is built by hand in a
          Vapi account, and the phone number has to be bought from Twilio, which
          is a real recurring charge. Until every step below is done by a person,
          this page stores settings and nothing else.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
          No part of this integration has ever been tested against a live call —
          there are no Vapi credentials for this deployment, so there was nothing
          to test against.
        </p>
      </section>

      {tableMissing ? (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-5">
          <h2 className="text-base font-semibold text-rose-900">Not set up yet</h2>
          <p className="mt-2 text-sm leading-relaxed text-rose-900/90">
            {MISSING_TABLE_MESSAGE}
          </p>
        </section>
      ) : null}

      {/* ── Setup checklist ────────────────────────────────────────────────── */}
      <section className="nwi-card p-5">
        <h2 className="text-base font-semibold text-slate-900">Setup checklist</h2>
        <p className="mt-1 text-sm text-slate-500">
          Every one of these is manual. None of them happen automatically.
        </p>

        <ol className="mt-4 space-y-3">
          {preflight.manualSteps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-relaxed text-slate-700">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <h3 className="mt-6 text-sm font-semibold text-slate-900">
          Environment variables
        </h3>
        <ul className="mt-2 space-y-2">
          {env.map((entry) => (
            <li key={entry.name} className="text-sm">
              <span
                className={
                  entry.set
                    ? 'rounded px-1.5 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-900'
                    : 'rounded px-1.5 py-0.5 text-xs font-semibold bg-rose-100 text-rose-900'
                }
              >
                {entry.set ? 'set' : 'missing'}
              </span>{' '}
              <code className="text-slate-900">{entry.name}</code>
              <span className="block text-slate-500">{entry.why}</span>
            </li>
          ))}
        </ul>

        <h3 className="mt-6 text-sm font-semibold text-slate-900">Server URL</h3>
        <p className="mt-1 text-sm text-slate-700">
          Register this as the assistant&apos;s Server URL in Vapi:{' '}
          <code className="text-slate-900">
            {preflight.serverUrl ?? '<NEXT_PUBLIC_APP_URL is not set>/api/vapi/webhook'}
          </code>
        </p>
        <p className="mt-2 text-sm text-slate-500">
          That route sits outside <code>/api/shop</code> because Vapi calls it
          with no session. It should also be listed as a public prefix in{' '}
          <code>proxy.ts</code> — today it gets through only because it matches
          neither the public nor the protected list, which is luck rather than a
          decision.
        </p>

        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            The system prompt to paste into the Vapi dashboard
          </summary>
          <p className="mt-2 text-sm text-slate-500">
            This is a version-controlled copy of the prompt. Editing it in this
            codebase changes nothing on its own — the live prompt is the one
            stored on the assistant in Vapi, and it has to be pasted there by
            hand. The <code>{'{{'}variable{'}}'}</code> placeholders are filled
            in per call by the webhook.
          </p>
          <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
            {FOREMAN_PROMPT_TEMPLATE}
          </pre>
        </details>
      </section>

      {/* ── Line status ────────────────────────────────────────────────────── */}
      <section className="nwi-card p-5">
        <h2 className="text-base font-semibold text-slate-900">This shop&apos;s line</h2>
        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="nwi-label">Phone number</dt>
            <dd className="text-sm text-slate-900">
              {settings.phone_number ?? 'None assigned'}
            </dd>
          </div>
          <div>
            <dt className="nwi-label">Vapi number id</dt>
            <dd className="text-sm text-slate-900">
              {settings.vapi_phone_number_id ?? 'Not imported'}
            </dd>
          </div>
          <div>
            <dt className="nwi-label">Blockers</dt>
            <dd className="text-sm text-slate-900">
              {blockers.length === 0 ? 'None in the environment' : `${blockers.length} missing`}
            </dd>
          </div>
        </dl>
      </section>

      <ForemanSettingsForm
        initialSettings={settings}
        canEdit={ctx.permissions.manageBilling && !tableMissing}
      />

      {/* ── Recent calls ───────────────────────────────────────────────────── */}
      <section className="nwi-card p-5">
        <h2 className="text-base font-semibold text-slate-900">Recent calls</h2>

        {callsResult.calls.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            No calls recorded. This list only ever fills in from real
            end-of-call reports sent by Vapi — there is no sample data here.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {callsResult.calls.map((call) => (
              <li key={call.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">
                    {call.from_number ?? 'Unknown number'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {call.started_at ? new Date(call.started_at).toLocaleString() : '—'} ·{' '}
                    {formatDuration(call.duration_seconds)} · {call.outcome ?? 'unknown'}
                  </p>
                </div>
                {call.summary ? (
                  <p className="mt-1 text-sm leading-relaxed text-slate-700">{call.summary}</p>
                ) : null}
                {call.transcript ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Transcript
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
                      {call.transcript}
                    </pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

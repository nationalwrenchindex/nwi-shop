'use client'

import { useState } from 'react'
import {
  DEFAULT_AFTER_HOURS_MESSAGE,
  DEFAULT_HOURS_END,
  DEFAULT_HOURS_START,
  DEFAULT_WORKING_DAYS,
  WEEKDAY_ABBREVIATIONS,
  type ShopForemanSettings,
} from '@/lib/shop/foreman/settings'

// settings.ts has no runtime dependencies — its only import is a type — so
// importing these constants here adds nothing to the browser bundle.

interface ForemanSettingsFormProps {
  initialSettings: ShopForemanSettings
  canEdit:         boolean
}

function errorFrom(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null) {
    const message = (payload as Record<string, unknown>).error
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

function warningFrom(payload: unknown): string | null {
  if (typeof payload === 'object' && payload !== null) {
    const warning = (payload as Record<string, unknown>).warning
    if (typeof warning === 'string' && warning.trim()) return warning
  }
  return null
}

export default function ForemanSettingsForm({
  initialSettings,
  canEdit,
}: ForemanSettingsFormProps) {
  const [enabled, setEnabled] = useState(initialSettings.is_enabled)
  const [greeting, setGreeting] = useState(initialSettings.greeting ?? '')
  const [start, setStart] = useState(
    (initialSettings.working_hours_start ?? DEFAULT_HOURS_START).slice(0, 5),
  )
  const [end, setEnd] = useState(
    (initialSettings.working_hours_end ?? DEFAULT_HOURS_END).slice(0, 5),
  )
  const [days, setDays] = useState<string[]>(
    initialSettings.working_days ?? [...DEFAULT_WORKING_DAYS],
  )
  const [afterHours, setAfterHours] = useState(
    initialSettings.after_hours_message ?? DEFAULT_AFTER_HOURS_MESSAGE,
  )
  const [services, setServices] = useState(initialSettings.services_list ?? '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function toggleDay(day: string) {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    )
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const res = await fetch('/api/shop/foreman', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_enabled:          enabled,
          greeting:            greeting.trim() || null,
          working_hours_start: start,
          working_hours_end:   end,
          working_days:        days,
          after_hours_message: afterHours.trim() || null,
          services_list:       services.trim() || null,
        }),
      })
      const payload: unknown = await res.json().catch(() => null)

      if (!res.ok) {
        setError(errorFrom(payload, 'Could not save those settings.'))
        return
      }

      setNotice(
        warningFrom(payload) ??
          'Saved. These values are sent to the assistant on each call — once the assistant exists.',
      )
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="nwi-card space-y-5 p-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Call handling</h2>
        <p className="mt-1 text-sm text-slate-500">
          These values are sent to the Vapi assistant as per-call overrides. They
          are stored here regardless of whether the assistant exists yet.
        </p>
      </div>

      {!canEdit ? (
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
          You can read these settings. Changing them is a manager job — Foreman
          answers the phone as the business and carries a monthly cost.
        </p>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
        >
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {notice}
        </div>
      ) : null}

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5"
          checked={enabled}
          disabled={!canEdit}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-semibold text-slate-900">
            Answer calls with Foreman
          </span>
          <span className="block text-sm text-slate-500">
            With this off, the webhook declines to hand out an assistant. With it
            on, calls are still only answered once a number is attached and the
            Vapi assistant exists.
          </span>
        </span>
      </label>

      <div>
        <label className="nwi-label" htmlFor="greeting">
          First thing the caller hears
        </label>
        <input
          id="greeting"
          className="nwi-input"
          value={greeting}
          disabled={!canEdit}
          placeholder="Thanks for calling. This is Foreman — how can I help?"
          onChange={(e) => setGreeting(e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="nwi-label" htmlFor="hours-start">
            Opens
          </label>
          <input
            id="hours-start"
            type="time"
            className="nwi-input"
            value={start}
            disabled={!canEdit}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div>
          <label className="nwi-label" htmlFor="hours-end">
            Closes
          </label>
          <input
            id="hours-end"
            type="time"
            className="nwi-input"
            value={end}
            disabled={!canEdit}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>

      <fieldset>
        <legend className="nwi-label">Working days</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_ABBREVIATIONS.map((day) => {
            const on = days.includes(day)
            return (
              <button
                key={day}
                type="button"
                disabled={!canEdit}
                onClick={() => toggleDay(day)}
                className={
                  on
                    ? 'nwi-btn nwi-btn-primary !min-h-0 px-3 py-1.5 text-xs'
                    : 'nwi-btn nwi-btn-secondary !min-h-0 px-3 py-1.5 text-xs'
                }
              >
                {day}
              </button>
            )
          })}
        </div>
      </fieldset>

      <div>
        <label className="nwi-label" htmlFor="after-hours">
          What Foreman says outside those hours
        </label>
        <textarea
          id="after-hours"
          className="nwi-input min-h-24"
          value={afterHours}
          disabled={!canEdit}
          onChange={(e) => setAfterHours(e.target.value)}
        />
      </div>

      <div>
        <label className="nwi-label" htmlFor="services">
          Services Foreman may quote time for
        </label>
        <textarea
          id="services"
          className="nwi-input min-h-24"
          value={services}
          disabled={!canEdit}
          placeholder="Oil Change (~60 min), Brake Service (~90 min), DOT Inspection (~90 min)"
          onChange={(e) => setServices(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">
          Leave blank to use the standard list. Foreman quotes labor time against
          your shop&apos;s hourly rate and never quotes parts.
        </p>
      </div>

      <div className="flex justify-end border-t border-slate-100 pt-4">
        <button type="submit" className="nwi-btn nwi-btn-primary" disabled={!canEdit || saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  )
}

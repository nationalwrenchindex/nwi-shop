'use client'

import { useState } from 'react'

export default function PortalButton({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function openPortal() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const body: { url?: string; error?: string } = await res.json()
      if (!res.ok || !body.url) {
        setError(body.error ?? 'Could not open the billing portal.')
        setBusy(false)
        return
      }
      window.location.href = body.url
    } catch {
      setError('Could not reach Stripe. Try again in a moment.')
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        className="nwi-btn nwi-btn-primary"
        onClick={openPortal}
        disabled={busy || disabled}
      >
        {busy ? 'Opening Stripe…' : 'Manage payment & invoices'}
      </button>
      {disabled ? (
        <p className="mt-2 text-sm text-slate-500">
          Available once your subscription is active.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { canAdvance, type AdvanceSubject } from '@/lib/shop/jobs'

/**
 * The one button that moves a job forward. The label and the disabled reason
 * both come from `canAdvance`, the same function the PATCH route calls, so the
 * button can never offer a transition the API would reject.
 */
export default function AdvanceButton({
  jobId,
  job,
  size = 'md',
}: {
  jobId: string
  job: AdvanceSubject
  size?: 'sm' | 'md'
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pending, startTransition] = useTransition()

  const check = canAdvance(job)
  const busy = saving || pending

  if (!check.next || !check.label) {
    return <span className="text-sm text-slate-500">{check.reason}</span>
  }

  async function advance() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/shop/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ advance: true }),
      })
      const payload: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        setError(
          payload && typeof payload === 'object' && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : 'Could not advance this job.',
        )
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setError('Network error - nothing was changed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={advance}
        disabled={!check.ok || busy}
        title={check.reason ?? undefined}
        className={`nwi-btn nwi-btn-primary ${size === 'sm' ? 'min-h-10 px-3 text-sm' : ''}`}
      >
        {busy ? 'Working...' : check.label}
      </button>
      {(error || (!check.ok && check.reason)) && (
        <p className="text-xs font-semibold text-red-700" role="alert">
          {error ?? check.reason}
        </p>
      )}
    </div>
  )
}

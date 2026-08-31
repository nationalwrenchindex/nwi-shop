'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Tech notes. This is the one field a tech may write on their own job, so it is
 * rendered for every role that can see the job at all.
 */
export default function NotesEditor({
  jobId,
  initialNotes,
}: {
  jobId: string
  initialNotes: string | null
}) {
  const router = useRouter()
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [saved, setSaved] = useState<string>(initialNotes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pending, startTransition] = useTransition()

  const busy = saving || pending
  const dirty = notes !== saved

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/shop/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      const payload: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        setError(
          payload && typeof payload === 'object' && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : 'Could not save your notes.',
        )
        return
      }
      setSaved(notes)
      startTransition(() => router.refresh())
    } catch {
      setError('Network error - your notes were not saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <label className="nwi-label" htmlFor={`notes-${jobId}`}>
        Tech notes
      </label>
      <textarea
        id={`notes-${jobId}`}
        className="nwi-input"
        rows={5}
        placeholder="What you found, what you did, what it still needs."
        value={notes}
        disabled={busy}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="nwi-btn nwi-btn-primary"
          disabled={busy || !dirty}
          onClick={save}
        >
          {busy ? 'Saving...' : 'Save notes'}
        </button>
        {!dirty && !busy && saved.length > 0 && (
          <span className="text-sm text-slate-500">Saved</span>
        )}
        {error && (
          <span className="text-sm font-semibold text-red-700" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  )
}

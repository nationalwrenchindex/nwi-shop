'use client'

import { useMemo, useState } from 'react'
import type {
  ShopSocialPost,
  SocialPlatform,
  SocialPostStatus,
} from '@/lib/shop/social'

// These label maps are duplicated from lib/shop/social.ts on purpose. That
// module imports the Gemini and Anthropic SDKs at the top level, so a value
// import from a client component would drag both into the browser bundle. The
// `import type` above is erased at compile time and costs nothing.
const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  tiktok:    'TikTok',
  instagram: 'Instagram',
  facebook:  'Facebook',
  linkedin:  'LinkedIn',
  twitter:   'X / Twitter',
}

const STATUS_LABELS: Record<SocialPostStatus, string> = {
  pending:   'Needs review',
  approved:  'Approved',
  posted:    'Marked posted',
  discarded: 'Discarded',
}

const STATUS_PILL: Record<SocialPostStatus, string> = {
  pending:   'bg-amber-100 text-amber-900',
  approved:  'bg-emerald-100 text-emerald-900',
  posted:    'bg-slate-200 text-slate-700',
  discarded: 'bg-rose-100 text-rose-900',
}

type Filter = SocialPostStatus | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'pending',   label: 'Needs review' },
  { key: 'approved',  label: 'Approved' },
  { key: 'posted',    label: 'Posted' },
  { key: 'discarded', label: 'Discarded' },
  { key: 'all',       label: 'All' },
]

interface SocialBoardProps {
  initialPosts: ShopSocialPost[]
  canManage:    boolean
  canGenerate:  boolean
  todaysTheme:  string
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * Deterministic on both sides of hydration. `toLocaleDateString()` reads the
 * runtime's locale, which is the server's during SSR and the browser's after —
 * a mismatch React reports as a hydration error.
 */
function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
}

function errorFrom(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null) {
    const message = (payload as Record<string, unknown>).error
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

export default function SocialBoard({
  initialPosts,
  canManage,
  canGenerate,
  todaysTheme,
}: SocialBoardProps) {
  const [posts, setPosts] = useState<ShopSocialPost[]>(initialPosts)
  const [filter, setFilter] = useState<Filter>('pending')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const counts = useMemo(() => {
    const tally: Record<Filter, number> = {
      pending: 0, approved: 0, posted: 0, discarded: 0, all: posts.length,
    }
    for (const post of posts) tally[post.status] += 1
    return tally
  }, [posts])

  const visible = useMemo(
    () => (filter === 'all' ? posts : posts.filter((p) => p.status === filter)),
    [posts, filter],
  )

  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/shop/social/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      })
      const payload: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        setError(errorFrom(payload, 'Could not draft posts right now.'))
        return
      }
      const fresh =
        typeof payload === 'object' && payload !== null
          ? ((payload as Record<string, unknown>).posts as ShopSocialPost[] | undefined)
          : undefined
      if (fresh?.length) {
        setPosts((prev) => [...fresh, ...prev])
        setFilter('pending')
      }
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setGenerating(false)
    }
  }

  async function patch(post: ShopSocialPost, body: Record<string, unknown>) {
    setBusyId(post.id)
    setError(null)
    try {
      const res = await fetch(`/api/shop/social/${post.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const payload: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        setError(errorFrom(payload, 'Could not save that change.'))
        return
      }
      const updated =
        typeof payload === 'object' && payload !== null
          ? ((payload as Record<string, unknown>).post as ShopSocialPost | undefined)
          : undefined
      if (updated) {
        setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        setDrafts((prev) => {
          const next = { ...prev }
          delete next[post.id]
          return next
        })
      }
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="nwi-label mb-0">Today&apos;s theme</p>
          <p className="text-sm text-slate-700">{todaysTheme}</p>
        </div>
        <button
          type="button"
          className="nwi-btn nwi-btn-primary"
          onClick={generate}
          disabled={!canGenerate || generating}
        >
          {generating ? 'Drafting…' : 'Draft five posts'}
        </button>
      </div>

      {!canManage ? (
        <p className="text-sm text-slate-500">
          You can read these drafts. Editing and approving them is a manager or
          foreman job.
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

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setFilter(entry.key)}
            className={
              filter === entry.key
                ? 'nwi-btn nwi-btn-primary !min-h-0 px-3 py-1.5 text-xs'
                : 'nwi-btn nwi-btn-secondary !min-h-0 px-3 py-1.5 text-xs'
            }
          >
            {entry.label} ({counts[entry.key]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="nwi-card p-8 text-center">
          <p className="text-sm text-slate-500">
            {posts.length === 0
              ? 'No drafts yet. Use “Draft five posts” to write one for each platform.'
              : 'Nothing in this list.'}
          </p>
        </div>
      ) : null}

      <div className="space-y-4">
        {visible.map((post) => {
          const draft = drafts[post.id]
          const edited = draft !== undefined && draft !== post.content
          const busy = busyId === post.id

          return (
            <article key={post.id} className="nwi-card p-5">
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {PLATFORM_LABELS[post.platform]}
                  </h3>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_PILL[post.status]}`}
                  >
                    {STATUS_LABELS[post.status]}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {formatDate(post.created_at)}
                  {post.theme ? ` · ${post.theme}` : ''}
                </p>
              </header>

              <label className="nwi-label mt-4" htmlFor={`content-${post.id}`}>
                Post copy
              </label>
              <textarea
                id={`content-${post.id}`}
                className="nwi-input min-h-40 font-normal leading-relaxed"
                value={draft ?? post.content}
                readOnly={!canManage}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))
                }
              />

              {post.visual_suggestion ? (
                <div className="mt-4">
                  <p className="nwi-label">What to shoot</p>
                  <p className="text-sm leading-relaxed text-slate-700">
                    {post.visual_suggestion}
                  </p>
                </div>
              ) : null}

              {post.image_prompt ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Image prompt — paste into your own image tool
                  </summary>
                  <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
                    {post.image_prompt}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    No image was generated. NWI Shop has no image provider
                    connected, so this is text you copy elsewhere.
                  </p>
                </details>
              ) : null}

              {canManage ? (
                <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    className="nwi-btn nwi-btn-secondary"
                    disabled={!edited || busy}
                    onClick={() => patch(post, { content: draft })}
                  >
                    Save edit
                  </button>
                  <button
                    type="button"
                    className="nwi-btn nwi-btn-primary"
                    disabled={busy || post.status === 'approved'}
                    onClick={() =>
                      patch(post, {
                        status: 'approved',
                        ...(edited ? { content: draft } : {}),
                      })
                    }
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="nwi-btn nwi-btn-secondary"
                    disabled={busy || post.status === 'posted'}
                    onClick={() => patch(post, { status: 'posted' })}
                  >
                    I posted this
                  </button>
                  <button
                    type="button"
                    className="nwi-btn nwi-btn-danger"
                    disabled={busy || post.status === 'discarded'}
                    onClick={() => patch(post, { status: 'discarded' })}
                  >
                    Discard
                  </button>
                </div>
              ) : null}

              {post.status === 'approved' ? (
                <p className="mt-3 text-xs text-slate-500">
                  Approved means a person signed off on the wording. It is not
                  scheduled and it has not been sent anywhere — copy it into the
                  app yourself.
                </p>
              ) : null}
            </article>
          )
        })}
      </div>
    </div>
  )
}

// Presentational pieces shared across the QuickWrench LD panels.
//
// The disclaimer and citation components are not decoration. Every AI-generated
// surface in this tool renders both — that is the rule the whole feature is
// built around, so they live here and are impossible to forget.

import type { ReactNode } from 'react'
import { AI_DISCLAIMER } from '@/lib/shop/quickwrench/ld'

export function Panel({
  title,
  subtitle,
  actions,
  children,
}: {
  title:     string
  subtitle?: string
  actions?:  ReactNode
  children:  ReactNode
}) {
  return (
    <section className="nwi-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

/* Deliberately NOT .nwi-card: that rule is unlayered CSS in globals.css and its
   white background beats Tailwind's layered color utilities. A colored card
   spells out its own surface. */

export function Notice({
  tone,
  title,
  children,
}: {
  tone:   'warning' | 'danger' | 'info'
  title?: string
  children: ReactNode
}) {
  const skin =
    tone === 'danger'
      ? 'border-red-200 bg-red-50 text-red-900'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-sky-200 bg-sky-50 text-sky-900'

  return (
    <div className={`rounded-xl border p-4 ${skin}`}>
      {title ? <p className="text-sm font-semibold">{title}</p> : null}
      <div className={`text-sm leading-relaxed ${title ? 'mt-1' : ''}`}>{children}</div>
    </div>
  )
}

/** The standing warning on every AI answer. Never conditional. */
export function AiDisclaimer() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
        Verify before you wrench
      </p>
      <p className="mt-1 text-xs leading-relaxed text-amber-900/90">{AI_DISCLAIMER}</p>
    </div>
  )
}

/** Grounding sources. Shown even when empty, because "no sources" is the single
 *  most important thing a tech can know about an answer. */
export function Citations({ urls }: { urls: string[] }) {
  if (urls.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No grounding sources were returned for this answer. Treat every value in it
        as unverified.
      </p>
    )
  }

  return (
    <div>
      <p className="nwi-label">Sources</p>
      <ul className="space-y-1">
        {urls.map((url) => (
          <li key={url} className="truncate text-xs">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 underline underline-offset-2 hover:text-sky-900"
            >
              {url}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Bullets({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="nwi-label">{title}</p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={`${title}-${i}`} className="flex gap-2 text-sm text-slate-700">
            <span
              aria-hidden
              className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Steps({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="nwi-label">{title}</p>
      <ol className="space-y-2">
        {items.map((item, i) => (
          <li key={`${title}-${i}`} className="flex gap-3 text-sm text-slate-700">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[0.6875rem] font-semibold text-white">
              {i + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="nwi-label">{label}</p>
      <p className={`text-sm ${value ? 'text-slate-900' : 'text-slate-400'}`}>
        {value ?? 'Not available'}
      </p>
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="text-sm text-slate-500" role="status">
      {label}
    </p>
  )
}

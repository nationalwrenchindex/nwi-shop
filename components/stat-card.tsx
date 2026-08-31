import type { ReactNode } from 'react'

export default function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  footer,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'warn' | 'good'
  footer?: ReactNode
}) {
  const valueTone =
    tone === 'warn'
      ? 'text-amber-600'
      : tone === 'good'
        ? 'text-emerald-600'
        : 'text-slate-900'

  return (
    <div className="nwi-card p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className={`mt-2 text-4xl font-bold tabular-nums ${valueTone}`}>{value}</p>
      {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  )
}

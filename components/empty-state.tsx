import type { ReactNode } from 'react'

export default function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="nwi-card flex flex-col items-center justify-center px-6 py-14 text-center">
      <p className="text-base font-semibold text-slate-800">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

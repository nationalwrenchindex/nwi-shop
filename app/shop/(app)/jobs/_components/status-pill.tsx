import { JOB_STATUS_LABELS, JOB_STATUS_PILL } from '@/lib/shop/jobs'
import type { JobStatus } from '@/lib/types'

export default function StatusPill({
  status,
  size = 'sm',
}: {
  status: JobStatus
  size?: 'sm' | 'lg'
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full font-bold uppercase tracking-wide ring-1 ring-inset ${
        JOB_STATUS_PILL[status]
      } ${size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'}`}
    >
      {JOB_STATUS_LABELS[status]}
    </span>
  )
}

import Link from 'next/link'
import AssignControls from './assign-controls'
import StatusPill from './status-pill'
import type { JobCard, TechOption } from '@/lib/shop/jobs'
import type { ShopBay } from '@/lib/types'

/** Jobs with no bay, newest first. Assignment is inline so dispatch is one tap. */
export default function JobQueue({
  jobs,
  bays,
  techs,
  canAssign,
}: {
  jobs: JobCard[]
  bays: ShopBay[]
  techs: TechOption[]
  canAssign: boolean
}) {
  if (jobs.length === 0) {
    return (
      <div className="nwi-card border-dashed p-6 text-center">
        <p className="text-base font-semibold text-slate-900">Nothing waiting</p>
        <p className="mt-1 text-sm text-slate-600">Every open job is in a bay.</p>
      </div>
    )
  }

  return (
    <ul className="nwi-card divide-y divide-slate-200">
      {jobs.map((job) => (
        <li key={job.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
          <Link
            href={`/shop/jobs/${job.id}`}
            className="font-mono text-base font-bold text-slate-900 underline-offset-4 hover:underline"
          >
            #{job.job_number}
          </Link>

          <div className="min-w-44 flex-1">
            <div className="truncate font-semibold text-slate-900">{job.customer_name}</div>
            <div className="truncate text-xs text-slate-500">{job.vehicle_label}</div>
          </div>

          <p className="min-w-52 flex-[2] line-clamp-2 text-sm text-slate-700">
            {job.complaint || job.description || 'No complaint recorded'}
          </p>

          <StatusPill status={job.status} />

          <span className="w-16 text-right font-mono text-sm text-slate-700 tabular-nums">
            {job.estimated_hours === null ? '--' : `${job.estimated_hours}h`}
          </span>

          {canAssign ? (
            <AssignControls
              compact
              jobId={job.id}
              bays={bays}
              techs={techs}
              currentBayId={job.bay_id}
              currentTechId={job.assigned_tech_id}
            />
          ) : (
            <span className="text-sm text-slate-600">{job.tech_name ?? 'Unassigned'}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

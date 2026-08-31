import Link from 'next/link'
import Elapsed from './elapsed'
import type { JobCard } from '@/lib/shop/jobs'
import type { BayStatus, BayType, ShopBay } from '@/lib/types'

const BAY_TYPE_LABELS: Record<BayType, string> = {
  lift:      'Lift',
  flat:      'Flat',
  alignment: 'Alignment',
  other:     'Bay',
}

/**
 * The status band is the whole point of the board - it has to read from across
 * the shop, so it is a solid saturated bar with white type, not a subtle tint.
 */
const BAND: Record<BayStatus, string> = {
  available:      'bg-emerald-600 text-white',
  occupied:       'bg-amber-500 text-amber-950',
  out_of_service: 'bg-red-700 text-white',
}

const OUTLINE: Record<BayStatus, string> = {
  available:      'border-emerald-600',
  occupied:       'border-amber-500',
  out_of_service: 'border-red-700',
}

const STATUS_TEXT: Record<BayStatus, string> = {
  available:      'Open',
  occupied:       'Working',
  out_of_service: 'Down',
}

export default function BayBoard({ bays, jobs }: { bays: ShopBay[]; jobs: JobCard[] }) {
  // A job's own bay_id is the truth for what is in a bay; current_job_id is the
  // fallback so a bay still reads correctly if the two ever drift.
  const byBay = new Map<string, JobCard>()
  for (const job of jobs) {
    if (job.bay_id && job.status !== 'completed' && job.status !== 'invoiced') {
      if (!byBay.has(job.bay_id)) byBay.set(job.bay_id, job)
    }
  }
  const byId = new Map(jobs.map((job) => [job.id, job]))

  if (bays.length === 0) {
    return (
      <div className="nwi-card border-dashed p-6 text-center">
        <p className="text-base font-semibold text-slate-900">No bays yet</p>
        <p className="mt-1 text-sm text-slate-600">
          Add your bays in shop settings and they will show up here.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {bays.map((bay) => {
        const job = byBay.get(bay.id) ?? (bay.current_job_id ? byId.get(bay.current_job_id) : undefined)
        const status: BayStatus = bay.status

        const card = (
          <div
            className={`nwi-card flex h-full flex-col overflow-hidden border-2 ${OUTLINE[status]} ${
              job ? 'transition-shadow hover:shadow-lg' : ''
            }`}
          >
            <div className={`flex items-baseline justify-between gap-2 px-3 py-2 ${BAND[status]}`}>
              <span className="truncate text-2xl leading-none font-black tracking-tight">
                {bay.label}
              </span>
              <span className="shrink-0 text-xs font-bold uppercase tracking-widest">
                {STATUS_TEXT[status]}
              </span>
            </div>

            <div className="flex min-h-30 flex-1 flex-col gap-1 px-3 py-2.5">
              <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                {BAY_TYPE_LABELS[bay.type]}
              </div>

              {job ? (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm font-bold text-slate-900">
                      #{job.job_number}
                    </span>
                    <span className="truncate text-sm font-semibold text-slate-800">
                      {job.customer_name}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm text-slate-700">
                    {job.complaint || job.description || 'No complaint recorded'}
                  </p>
                  <p className="truncate text-xs text-slate-500">{job.vehicle_label}</p>
                  <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                    <span className="truncate text-sm font-semibold text-slate-900">
                      {job.tech_name ?? 'Unassigned'}
                    </span>
                    <Elapsed
                      since={job.bay_assigned_at}
                      className="shrink-0 font-mono text-lg leading-none font-bold text-slate-900 tabular-nums"
                    />
                  </div>
                </>
              ) : (
                <p className="mt-auto text-sm text-slate-500">
                  {status === 'out_of_service' ? 'Out of service' : 'Ready for the next job'}
                </p>
              )}
            </div>
          </div>
        )

        return job ? (
          <Link
            key={bay.id}
            href={`/shop/jobs/${job.id}`}
            className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
          >
            {card}
          </Link>
        ) : (
          <div key={bay.id}>{card}</div>
        )
      })}
    </div>
  )
}

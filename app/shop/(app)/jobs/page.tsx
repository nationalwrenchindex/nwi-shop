import type { Metadata } from 'next'
import { requireShop } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { loadJobBoard, unassignedJobs } from '@/lib/shop/jobs'
import BayBoard from './_components/bay-board'
import JobQueue from './_components/job-queue'
import NewJobModal from './_components/new-job-modal'

export const metadata: Metadata = { title: 'Job board' }

export default async function JobBoardPage() {
  const ctx = await requireShop()
  const supabase = await createClient()

  // A tech is scoped to their own jobs in the query itself - the board never
  // loads rows they are not allowed to see.
  const canDispatch = ctx.permissions.viewAllJobs
  const { bays, jobs, techs, degraded } = await loadJobBoard(supabase, {
    shopId: ctx.shop.id,
    techId: canDispatch ? null : ctx.tech.id,
  })

  const waiting = unassignedJobs(jobs)
  const working = jobs.filter((job) => job.status === 'in_progress').length
  const openBays = bays.filter((bay) => bay.status === 'available').length

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Job board</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            {canDispatch
              ? `${openBays} of ${bays.length} bays open · ${working} in progress · ${waiting.length} waiting`
              : `${working} of your jobs in progress · ${waiting.length} waiting`}
          </p>
        </div>
        {canDispatch && <NewJobModal />}
      </header>

      {degraded && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          No shop data came back. If this shop was just created, the bays and jobs tables may not be
          set up yet.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Bays</h2>
        <BayBoard bays={bays} jobs={jobs} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">
          Waiting for a bay ({waiting.length})
        </h2>
        <JobQueue jobs={waiting} bays={bays} techs={techs} canAssign={canDispatch} />
      </section>
    </div>
  )
}

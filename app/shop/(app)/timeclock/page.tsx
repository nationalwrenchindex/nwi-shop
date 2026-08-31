// /shop/timeclock — the tech's own clock. Every role reaches this page, and
// every role sees exactly one person on it: themselves. The status payload is
// built with `selfOnly` for a tech, so no other name or hour count is even
// fetched, let alone rendered.

import type { Metadata } from 'next'
import Link from 'next/link'
import { requireShop } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { addDays, dateKey } from '@/lib/shop/timeclock'
import type { JobRef } from '@/lib/shop/timeclock'
import { buildStatus, fetchPunchableJobs } from '@/app/api/shop/timeclock/_queries'
import PunchHistory from './_components/punch-history'
import TechClock from './_components/tech-clock'

export const metadata: Metadata = { title: 'Time Clock' }

/** How far back the history panel reaches on first load. */
const HISTORY_DAYS = 13

export default async function TimeclockPage() {
  const ctx = await requireShop()
  const supabase = await createClient()
  const now = new Date()

  const initialStatus = await buildStatus(supabase, {
    shopId: ctx.shop.id,
    // A tech is always self-scoped. A foreman or manager still lands on their
    // own clock here — the shop-wide roster lives on the manager route.
    selfTech: ctx.tech,
    selfOnly: true,
    now,
  })

  const jobs = await fetchPunchableJobs(
    supabase,
    ctx.shop.id,
    ctx.tech.id,
    ctx.permissions.viewAllJobs,
  )

  const jobRefs: JobRef[] = jobs.map((job) => ({
    id: job.id,
    job_number: job.job_number,
    description: job.description,
  }))

  const techName = `${ctx.tech.first_name} ${ctx.tech.last_name}`.trim()

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-black tracking-tight">Time Clock</h1>
        {ctx.permissions.runPayroll && (
          <Link
            href="/shop/timeclock/manager"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
          >
            Shop roster &amp; payroll
          </Link>
        )}
      </header>

      <TechClock
        initialStatus={initialStatus}
        jobs={jobRefs}
        techId={ctx.tech.id}
        techName={techName}
        jobsHeading={ctx.permissions.viewAllJobs ? 'Open jobs' : 'My jobs'}
      />

      <PunchHistory
        defaultFrom={dateKey(addDays(now, -HISTORY_DAYS))}
        defaultTo={dateKey(now)}
      />
    </main>
  )
}

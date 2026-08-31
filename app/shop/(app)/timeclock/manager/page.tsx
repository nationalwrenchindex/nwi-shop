// /shop/timeclock/manager — shop-wide roster and payroll export.
// Gated on `runPayroll`, so a foreman who follows a link here is redirected
// back to /shop by `requirePermission` before anything renders.

import type { Metadata } from 'next'
import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  dateKey,
  DEFAULT_WEEK_STARTS_ON,
  IDLE_ALERT_MINUTES,
  NO_JOB_ALERT_MINUTES,
  startOfWeek,
} from '@/lib/shop/timeclock'
import { buildStatus, fetchTechs } from '@/app/api/shop/timeclock/_queries'
import PayrollExport from './_components/payroll-export'
import RosterBoard from './_components/roster-board'

export const metadata: Metadata = { title: 'Shop Roster & Payroll' }

export default async function TimeclockManagerPage() {
  const ctx = await requirePermission('runPayroll')
  const supabase = await createClient()
  const now = new Date()

  const initialStatus = await buildStatus(supabase, {
    shopId: ctx.shop.id,
    selfTech: ctx.tech,
    selfOnly: false,
    now,
  })

  const techs = await fetchTechs(supabase, ctx.shop.id)

  // Default the export to the current work week.
  const weekStart = startOfWeek(now, DEFAULT_WEEK_STARTS_ON)

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Shop Roster</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {ctx.shop.business_name}
          </p>
        </div>
        <Link
          href="/shop/timeclock"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
        >
          My clock
        </Link>
      </header>

      <RosterBoard
        initialStatus={initialStatus}
        idleThresholdMinutes={IDLE_ALERT_MINUTES}
        noJobThresholdMinutes={NO_JOB_ALERT_MINUTES}
      />

      <PayrollExport
        defaultFrom={dateKey(weekStart)}
        defaultTo={dateKey(now)}
        today={dateKey(now)}
        techs={techs.map((tech) => ({
          id: tech.id,
          name: `${tech.first_name} ${tech.last_name}`.trim(),
        }))}
      />

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Idle time is shop-clock minutes minus job minutes over the same window. A tech
        can be on the shop clock and a job at once — only the shop clock pays.
      </p>
    </main>
  )
}

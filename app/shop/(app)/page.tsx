import type { Metadata } from 'next'
import Link from 'next/link'
import { requireShop } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { ROLE_LABELS, TIER_LABELS } from '@/lib/permissions'
import type { JobStatus, ShopInventory, ShopJob, ShopTimeclock } from '@/lib/types'
import PageHeader from '@/components/page-header'
import StatCard from '@/components/stat-card'
import ToolsStrip from './tools/_components/tools-strip'

export const metadata: Metadata = { title: 'Dashboard' }

const OPEN_STATUSES: JobStatus[] = ['estimate', 'approved', 'in_progress']

/**
 * Every count below is wrapped so a failing query yields a zero rather than a
 * thrown page. This graceful degradation is DELIBERATE: the dashboard is the
 * landing page for every role, and the shop_* migrations may not be applied in a
 * given environment yet. A missing table must show an empty shop, never a crash.
 */
async function safeCount(run: () => Promise<number>): Promise<number> {
  try {
    return await run()
  } catch {
    return 0
  }
}

function StatLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-sm font-semibold text-slate-700 hover:text-slate-900">
      {label} &rarr;
    </Link>
  )
}

export default async function ShopDashboardPage() {
  // shopType + tier come straight off the context: it already resolves the
  // subscription row over the profile fallback, so the tools strip and the plan
  // label below cannot disagree about what this shop is on.
  const { shop, tech, role, permissions, shopType, tier } = await requireShop()
  const supabase = await createClient()

  const openJobs = await safeCount(async () => {
    let query = supabase
      .from('shop_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', shop.id)
      .eq('voided', false)
      .in('status', OPEN_STATUSES)

    if (!permissions.viewAllJobs) query = query.eq('assigned_tech_id', tech.id)

    const { count, error } = await query
    if (error) return 0
    return count ?? 0
  })

  // ---- Tech view: own jobs, own clock, nothing else ----------------------
  if (!permissions.viewAllJobs) {
    let openPunch: ShopTimeclock | null = null
    try {
      const { data } = await supabase
        .from('shop_timeclock')
        .select('*')
        .eq('shop_id', shop.id)
        .eq('tech_id', tech.id)
        .is('punch_out', null)
        .order('punch_in', { ascending: false })
        .limit(1)
        .maybeSingle<ShopTimeclock>()
      openPunch = data ?? null
    } catch {
      openPunch = null
    }

    type MyJob = Pick<ShopJob, 'id' | 'job_number' | 'status' | 'description'>
    let myJobs: MyJob[] = []
    try {
      const { data } = await supabase
        .from('shop_jobs')
        .select('id, job_number, status, description')
        .eq('shop_id', shop.id)
        .eq('assigned_tech_id', tech.id)
        .eq('voided', false)
        .in('status', OPEN_STATUSES)
        .order('job_number', { ascending: true })
        .limit(8)
        .returns<MyJob[]>()
      myJobs = data ?? []
    } catch {
      myJobs = []
    }

    return (
      <div className="space-y-6">
        <PageHeader
          title={`Welcome back, ${tech.first_name}`}
          subtitle={`${shop.business_name} · ${ROLE_LABELS[role]}`}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label="My open jobs"
            value={openJobs}
            hint="Assigned to you and not yet completed"
            footer={<StatLink href="/shop/jobs" label="Job board" />}
          />
          <StatCard
            label="Clock status"
            value={openPunch ? 'Clocked in' : 'Clocked out'}
            tone={openPunch ? 'good' : 'default'}
            hint={
              openPunch
                ? `Since ${new Date(openPunch.punch_in).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}`
                : 'Punch in from the timeclock'
            }
            footer={<StatLink href="/shop/timeclock" label="Timeclock" />}
          />
        </div>

        <section className="nwi-card overflow-hidden">
          <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold uppercase tracking-wider text-slate-600">
            My work
          </h2>
          {myJobs.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              Nothing assigned to you right now.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {myJobs.map((job) => (
                <li
                  key={job.id}
                  className="flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">Job #{job.job_number}</p>
                    <p className="truncate text-sm text-slate-500">
                      {job.description ?? 'No description'}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {job.status.replace('_', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Tools are gated by shop type and tier, never by role — a tech gets
            the same strip a manager does. */}
        <ToolsStrip shopType={shopType} tier={tier} />
      </div>
    )
  }

  // ---- Manager / foreman view -------------------------------------------
  const clockedIn = await safeCount(async () => {
    const { data, error } = await supabase
      .from('shop_timeclock')
      .select('tech_id')
      .eq('shop_id', shop.id)
      .is('punch_out', null)
      .returns<Pick<ShopTimeclock, 'tech_id'>[]>()
    if (error || !data) return 0
    return new Set(data.map((row) => row.tech_id)).size
  })

  // Postgrest cannot compare two columns in a filter, so the reorder-point check
  // runs here over the shop's own parts list.
  const lowStock = await safeCount(async () => {
    const { data, error } = await supabase
      .from('shop_inventory')
      .select('quantity_on_hand, reorder_point')
      .eq('shop_id', shop.id)
      .returns<Pick<ShopInventory, 'quantity_on_hand' | 'reorder_point'>[]>()
    if (error || !data) return 0
    return data.filter((row) => row.quantity_on_hand <= row.reorder_point).length
  })

  const activeTechs = await safeCount(async () => {
    const { count, error } = await supabase
      .from('shop_techs')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', shop.id)
      .eq('active', true)
    if (error) return 0
    return count ?? 0
  })

  // Money-shaped. Manager only — a foreman never sees anything tied to revenue.
  const readyToInvoice = permissions.viewFinancials
    ? await safeCount(async () => {
        const { count, error } = await supabase
          .from('shop_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('shop_id', shop.id)
          .eq('voided', false)
          .eq('status', 'completed')
        if (error) return 0
        return count ?? 0
      })
    : 0

  return (
    <div className="space-y-6">
      <PageHeader
        title={shop.business_name}
        subtitle={`${ROLE_LABELS[role]} · ${TIER_LABELS[tier]}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open jobs"
          value={openJobs}
          hint="Estimate, approved or in progress"
          footer={<StatLink href="/shop/jobs" label="Job board" />}
        />
        <StatCard
          label="Clocked in"
          value={clockedIn}
          tone={clockedIn > 0 ? 'good' : 'default'}
          hint={`of ${activeTechs} active ${activeTechs === 1 ? 'tech' : 'techs'}`}
          footer={<StatLink href="/shop/timeclock" label="Timeclock" />}
        />
        <StatCard
          label="Low stock parts"
          value={lowStock}
          tone={lowStock > 0 ? 'warn' : 'default'}
          hint="At or below reorder point"
          footer={
            permissions.manageInventory ? (
              <StatLink href="/shop/inventory" label="Inventory" />
            ) : null
          }
        />
        {permissions.viewFinancials ? (
          <StatCard
            label="Ready to invoice"
            value={readyToInvoice}
            hint="Completed, not yet invoiced"
            footer={<StatLink href="/shop/financials" label="Financials" />}
          />
        ) : (
          <StatCard
            label="Active techs"
            value={activeTechs}
            hint="On the roster"
            footer={
              permissions.manageTechs ? <StatLink href="/shop/team" label="Team" /> : null
            }
          />
        )}
      </div>

      <ToolsStrip shopType={shopType} tier={tier} />
    </div>
  )
}

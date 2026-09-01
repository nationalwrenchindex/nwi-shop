// /shop/tools/epa-608 — the EPA Section 608 refrigerant log.
//
// requireFeature() is the FIRST statement in the component, so a shop without the
// feature is redirected to /shop before any of this page renders or any query
// runs. NWI Suite's /hd/epa-log had no gate at all — any signed-in account
// reached it — and no way to add an entry: its "+ Log Entry" button opened a
// panel reading "coming in the next update". The form on this page is the write
// path that product never shipped.

import type { Metadata } from 'next'
import PageHeader from '@/components/page-header'
import StatCard from '@/components/stat-card'
import { requireFeature } from '@/lib/auth'
import { FEATURE_LABELS } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import {
  EPA_ACTION_LABELS,
  EPA_ACTION_PILL,
  formatPounds,
  shopEpaCertNumber,
  totalPounds,
  totalsByRefrigerant,
  type ShopEpaLogEntry,
} from '@/lib/shop/epa'
import { loadFormOptions } from '@/lib/shop/inspections/form-options'
import EpaEntryForm from './_components/epa-entry-form'

export const metadata: Metadata = { title: FEATURE_LABELS.epa_608 }

const ROW_LIMIT = 200

export default async function Epa608Page() {
  const ctx = await requireFeature('epa_608')

  const supabase = await createClient()

  // Managers and foremen run the shop's totals; a tech sees the entries they
  // signed. RLS permits the whole shop either way — this is the product rule.
  let query = supabase
    .from('shop_epa_log')
    .select('*')
    .eq('shop_id', ctx.shop.id)
    .order('log_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(ROW_LIMIT)
  if (!ctx.permissions.viewAllJobs) query = query.eq('tech_id', ctx.tech.id)

  const [{ data, error }, options] = await Promise.all([
    query.returns<ShopEpaLogEntry[]>(),
    loadFormOptions(supabase, ctx.shop.id),
  ])

  // Degrade rather than crash: migration 010 is applied by hand and the log is
  // more useful as "empty, and here is why" than as an error page.
  const entries = data ?? []
  const warning = error?.message ?? null

  const totals = totalsByRefrigerant(entries)
  const jobLabel = new Map(options.jobs.map((job) => [job.id, job.job_number]))
  const vehicleLabels = new Map(options.vehicles.map((vehicle) => [vehicle.id, vehicle.label]))
  const techNames = new Map(options.techs.map((tech) => [tech.id, tech.name]))

  return (
    <div className="space-y-6">
      <PageHeader
        title={FEATURE_LABELS.epa_608}
        subtitle="40 CFR Part 82 · every pound in, out and evacuated"
      />

      <section className="rounded-xl border border-red-200 bg-red-50 p-5">
        <h2 className="text-base font-semibold text-red-900">
          EPA 608 certified technicians only
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-red-900/90">
          Federal regulation requires every pound of refrigerant recovered, added
          and evacuated to be recorded, with the certification number of the
          technician who did the work. Refrigerant exposure causes frostbite and
          asphyxiation — wear full PPE and never work alone.
        </p>
      </section>

      {warning && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-base font-semibold text-amber-900">Log unavailable</h2>
          <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
            The refrigerant log could not be read, so nothing is listed below. This
            is expected until migration <code>010_shop_epa_log.sql</code> has been
            applied in the Supabase SQL editor.
          </p>
          <p className="mt-2 font-mono text-xs text-amber-900/80">{warning}</p>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Entries" value={String(entries.length)} />
        <StatCard label="Total tracked" value={formatPounds(totalPounds(entries))} />
        <StatCard
          label="Added"
          value={formatPounds(totals.reduce((sum, row) => sum + row.added, 0))}
        />
        <StatCard
          label="Recovered"
          value={formatPounds(totals.reduce((sum, row) => sum + row.recovered, 0))}
        />
      </section>

      <EpaEntryForm
        jobs={options.jobs}
        vehicles={options.vehicles}
        techs={options.techs}
        currentTechId={ctx.tech.id}
        canLogForOthers={ctx.permissions.viewAllJobs}
        defaultCertNumber={shopEpaCertNumber(ctx.shop)}
      />

      {totals.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Totals by refrigerant</h2>
          <div className="nwi-card overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  {['Refrigerant', 'Entries', 'Added', 'Recovered', 'Evacuated', 'Net'].map((head) => (
                    <th
                      key={head}
                      className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {totals.map((row) => (
                  <tr key={row.refrigerant} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.refrigerant}</td>
                    <td className="px-4 py-3 text-slate-600">{row.entries}</td>
                    <td className="px-4 py-3 text-slate-700">{formatPounds(row.added)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatPounds(row.recovered)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatPounds(row.evacuated)}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {formatPounds(row.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Net is added minus recovered — the figure an auditor compares against
            cylinder purchases.
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          {ctx.permissions.viewAllJobs ? 'Shop log' : 'My entries'}
        </h2>
        {entries.length === 0 ? (
          <div className="nwi-card px-6 py-14 text-center">
            <p className="text-base font-semibold text-slate-800">No entries logged</p>
            <p className="mt-1 text-sm text-slate-500">
              {warning
                ? 'Apply migration 010 and entries will appear here.'
                : 'Use the form above the first time refrigerant is recovered or charged.'}
            </p>
          </div>
        ) : (
          <div className="nwi-card overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  {['Date', 'Unit', 'Refrigerant', 'Action', 'Pounds', 'Tech', 'Cert #', 'Reason'].map(
                    (head) => (
                      <th
                        key={head}
                        className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {head}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{entry.log_date}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {(entry.vehicle_id && vehicleLabels.get(entry.vehicle_id)) ||
                        (entry.job_id && jobLabel.has(entry.job_id)
                          ? `Work order #${jobLabel.get(entry.job_id)}`
                          : '—')}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {entry.refrigerant_type}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${EPA_ACTION_PILL[entry.action]}`}
                      >
                        {EPA_ACTION_LABELS[entry.action]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                      {formatPounds(Number(entry.pounds))}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {(entry.tech_id && techNames.get(entry.tech_id)) || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {entry.tech_certification_number || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{entry.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

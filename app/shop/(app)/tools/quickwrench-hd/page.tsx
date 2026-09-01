// /shop/tools/quickwrench-hd — gated on the shop TYPE and the plan, not the
// user's role. requireFeature() is the FIRST statement in the component, so a
// light-duty shop or an under-tiered one is redirected to /shop before any of
// this renders. Every route behind the panels re-checks with apiFeature().
//
// Server Component: it resolves the engine status and the tech's open jobs, then
// hands both to the client shell. Nothing about which AI keys exist reaches the
// browser beyond the booleans in EngineStatus.

import type { Metadata } from 'next'
import Link from 'next/link'
import PageHeader from '@/components/page-header'
import { requireFeature } from '@/lib/auth'
import { FEATURE_LABELS } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { hdEngineStatus } from '@/lib/shop/quickwrench/hd'
import ToolShell from './_components/tool-shell'
import type { JobOption } from './_components/types'

export const metadata: Metadata = { title: FEATURE_LABELS.quickwrench_hd }

interface OpenJobRow {
  id:               string
  job_number:       number
  description:      string | null
  complaint:        string | null
  assigned_tech_id: string | null
}

export default async function QuickWrenchHdPage() {
  const ctx = await requireFeature('quickwrench_hd')

  // Open jobs the diagnostic can be attached to. Scoped exactly as the jobs API
  // scopes them — a tech sees only their own — so the picker can never offer a
  // job the PATCH would then refuse.
  let jobs: JobOption[] = []
  try {
    const supabase = await createClient()
    let query = supabase
      .from('shop_jobs')
      .select('id, job_number, description, complaint, assigned_tech_id')
      .eq('shop_id', ctx.shop.id)
      .eq('voided', false)
      .neq('status', 'invoiced')
      .order('job_number', { ascending: false })
      .limit(50)
    if (!ctx.permissions.viewAllJobs) query = query.eq('assigned_tech_id', ctx.tech.id)

    const { data } = await query.returns<OpenJobRow[]>()
    jobs = (data ?? []).map((row) => ({
      id:        row.id,
      jobNumber: row.job_number,
      label: `#${row.job_number}${
        row.description?.trim()
          ? ` — ${row.description.trim()}`
          : row.complaint?.trim()
            ? ` — ${row.complaint.trim()}`
            : ''
      }`,
    }))
  } catch {
    // A failed job read must not take the diagnostic tool down with it — the
    // panels still work, only the "attach to job" picker is empty.
    jobs = []
  }

  const engine = hdEngineStatus()

  return (
    <div className="space-y-6">
      <PageHeader
        title={FEATURE_LABELS.quickwrench_hd}
        subtitle="Class 6-8 trucks, trailers and transport refrigeration."
        actions={
          <Link href="/shop/tools" className="nwi-btn nwi-btn-secondary">
            Back to Tools
          </Link>
        }
      />

      {/* Deliberately NOT .nwi-card — that rule is unlayered CSS in globals.css
          and its white background wins over Tailwind's layered color utilities. */}
      <section className="rounded-xl border border-slate-300 bg-slate-50 p-4 sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
          Before you turn a wrench
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          The diagnosis panel is AI-generated. Treat it as a second opinion from a
          tech who is not looking at the vehicle: it can be wrong, and a wrong
          torque spec or refrigerant charge on a Class 8 truck injures somebody.
          Verify every specification, part number, torque value and charge weight
          against the OEM service manual before acting on it. Source links are
          shown whenever the engine could provide them.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          Fault-code decode, gauge readings, VIN decode and parts lookup do not use
          AI at all. They read shipped reference data and the shared parts catalog,
          and they work whether or not an AI key is configured.
        </p>
        {engine.primary === null ? (
          <p className="mt-2 text-sm font-semibold text-amber-800">
            No AI key is configured on this deployment, so the diagnosis panel
            cannot generate an answer right now. Everything else on this page
            works.
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            Diagnosis engine: {engine.model}
            {engine.grounded
              ? ' — searches the web and returns source links.'
              : ' — does not search the web, so it returns no source links. Check every figure against the manual.'}
          </p>
        )}
      </section>

      <ToolShell jobs={jobs} engine={engine} />
    </div>
  )
}

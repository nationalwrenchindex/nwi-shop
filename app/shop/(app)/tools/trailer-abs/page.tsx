// /shop/tools/trailer-abs — Trailer ABS.
//
// Two halves, and the split is the whole design:
//
//   1. REFERENCE BROWSER — air brakes, chambers, slack adjusters, shoes and drums, ABS
//      blink codes, the J560 pin-out and the fastener torques. Read live from the shared
//      hd_trailer_reference catalog. No AI is involved anywhere in it, so it works in
//      full on a deployment with no GEMINI_API_KEY. This is the half a tech uses most.
//
//   2. AI DIAGNOSTIC — needs the key. When it is absent the form is disabled and a
//      banner says so plainly, instead of a control that fails when pressed.
//
// Gated on the shop TYPE and tier, not the user's role: requireFeature('trailer_abs') is
// the FIRST statement, so a light-duty or starter-tier shop is redirected to /shop before
// any of this renders.

import type { Metadata } from 'next'
import Link from 'next/link'
import PageHeader from '@/components/page-header'
import { requireFeature } from '@/lib/auth'
import { isGeminiConfigured } from '@/lib/gemini'
import { FEATURE_LABELS } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { lookupTrailerReference } from '@/lib/shop/trailer/reference'
import type { ShopJob } from '@/lib/types'
import AbsDiagnostic from './_components/abs-diagnostic'
import ReferenceBrowser from './_components/reference-browser'

export const metadata: Metadata = { title: FEATURE_LABELS.trailer_abs }

/** Jobs a diagnostic can be attached to. Anything invoiced or voided is closed. */
const OPEN_STATUSES = ['estimate', 'approved', 'in_progress', 'completed'] as const

type OpenJob = Pick<ShopJob, 'id' | 'job_number' | 'status' | 'description'>

export default async function TrailerAbsPage() {
  const ctx = await requireFeature('trailer_abs')

  const supabase = await createClient()

  // The whole catalog in one read — it is ~100 rows. The browser filters it in the
  // client from there, exactly as the source panel did: a tech on shop wifi under a
  // trailer should not wait on a round trip to type a search.
  let reference
  try {
    reference = await lookupTrailerReference(null, '')
  } catch {
    // A failed catalog read must not take the page down — the AI half and the reload
    // control still work, and the browser renders its own empty state.
    reference = { entries: [], source: 'live' as const, available: true }
  }

  // Jobs this person may attach a result to. A tech sees only their own; a foreman or
  // manager sees the whole floor. Same rule the jobs API enforces again on write.
  let jobQuery = supabase
    .from('shop_jobs')
    .select('id, job_number, status, description')
    .eq('shop_id', ctx.shop.id)
    .eq('voided', false)
    .in('status', [...OPEN_STATUSES])
    .order('job_number', { ascending: false })
    .limit(50)

  if (!ctx.permissions.viewAllJobs) {
    jobQuery = jobQuery.eq('assigned_tech_id', ctx.tech.id)
  }

  const { data: jobRows } = await jobQuery.returns<OpenJob[]>()

  const geminiReady = isGeminiConfigured()

  return (
    <div className="space-y-6">
      <PageHeader
        title={FEATURE_LABELS.trailer_abs}
        subtitle="Trailer air brake, ABS and electrical reference, plus an AI-assisted blink-code diagnostic."
      />

      {/* Deliberately NOT .nwi-card: that rule is unlayered CSS in globals.css, so its
          white background and slate border win over Tailwind's layered color utilities.
          A card that needs its own color spells it out. */}
      <section
        role="note"
        className="rounded-xl border border-red-200 bg-red-50 p-4 sm:p-5"
      >
        <h2 className="text-base font-semibold text-red-900">
          Brakes are life-safety. Verify before you release the trailer.
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-red-900/90">
          Trailer ABS is a federally mandated system under FMVSS 121. Everything on this
          page — the reference rows and anything the AI diagnostic returns — is a
          starting point for diagnosis, never a substitute for the manufacturer service
          manual for the exact ECU part number in front of you. Blink code tables differ
          between ECU generations: a chart for the wrong generation will point you at the
          wrong wheel end. Confirm the code and the repair against the literature before
          you touch the brakes or put the trailer back in service.
        </p>
      </section>

      <ReferenceBrowser
        initialEntries={reference.entries}
        initialSource={reference.source}
        catalogAvailable={reference.available}
      />

      <AbsDiagnostic
        geminiReady={geminiReady}
        jobs={jobRows ?? []}
        techId={ctx.tech.id}
      />

      <div>
        <Link href="/shop/tools" className="nwi-btn nwi-btn-secondary">
          Back to Tools
        </Link>
      </div>
    </div>
  )
}

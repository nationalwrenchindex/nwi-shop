'use client'

// Renders one LdDiagnostic. Every path through this component ends with the
// citations and the AI disclaimer — there is no variant that hides them.

import type { LdDiagnostic, LdSeverity } from '@/lib/shop/quickwrench/ld'
import { AiDisclaimer, Bullets, Citations, Notice, Steps } from './ui'

const SEVERITY_SKIN: Record<Exclude<LdSeverity, ''>, string> = {
  low:      'border-emerald-200 bg-emerald-50 text-emerald-900',
  moderate: 'border-amber-200 bg-amber-50 text-amber-900',
  high:     'border-orange-200 bg-orange-50 text-orange-900',
  critical: 'border-red-200 bg-red-50 text-red-900',
}

export default function DiagnosticResult({
  result,
  cached,
}: {
  result: LdDiagnostic
  cached: boolean
}) {
  const hasCode = result.code !== '' && result.code !== 'NO-CODE'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {hasCode ? (
              <span className="rounded-md bg-slate-900 px-2 py-1 font-mono text-sm font-semibold text-white">
                {result.code}
              </span>
            ) : (
              <span className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Symptom based
              </span>
            )}
            <h3 className="text-lg font-semibold text-slate-900">{result.name}</h3>
          </div>
          {result.category ? (
            <p className="mt-1 text-sm text-slate-500">{result.category}</p>
          ) : null}
        </div>
        {cached ? (
          <span className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500">
            Previously generated answer
          </span>
        ) : null}
      </div>

      {result.severity ? (
        <div className={`rounded-xl border p-4 ${SEVERITY_SKIN[result.severity]}`}>
          <p className="text-xs font-semibold uppercase tracking-wide">
            Severity: {result.severity}
          </p>
          {result.severity_description ? (
            <p className="mt-1 text-sm leading-relaxed">{result.severity_description}</p>
          ) : null}
        </div>
      ) : null}

      {result.safety_warnings ? (
        <Notice tone="danger" title="Safety">
          {result.safety_warnings}
        </Notice>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <Bullets title="Symptoms" items={result.symptoms} />
        <Bullets title="Common causes" items={result.common_causes} />
      </div>

      <Steps title="Diagnostic order" items={result.diagnostic_order} />
      <Steps title="Repair procedure" items={result.repair_steps} />

      <div className="grid gap-5 md:grid-cols-2">
        <Bullets title="Parts needed" items={result.parts_needed} />
        <Bullets title="Related codes" items={result.related_codes} />
      </div>

      <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
        <div>
          <p className="nwi-label">Suggested repair</p>
          <p className="text-sm text-slate-700">{result.suggested_repair || 'Not stated'}</p>
        </div>
        <div>
          <p className="nwi-label">Special tools</p>
          <p className="text-sm text-slate-700">{result.special_tools || 'Not stated'}</p>
        </div>
        <div>
          <p className="nwi-label">Labor estimate</p>
          <p className="text-sm text-slate-700">{result.labor_estimate || 'Not stated'}</p>
        </div>
      </div>

      <Citations urls={result.citations} />
      <AiDisclaimer />
    </div>
  )
}

'use client'

// Renders one AI diagnostic. The ordering here is a safety decision, not a
// layout preference:
//
//   1. hazard banner   — if the answer mentions high voltage, refrigerant work,
//                        high pressure or a running engine, that lands before
//                        anything else on the screen
//   2. verification    — this is AI output and must be checked against the
//                        service manual before anyone turns a wrench
//   3. the diagnostic  — SAFETY WARNINGS is pulled to the top of the sections
//   4. provenance      — which engine answered, its grounding citations, and
//                        the manufacturer disclaimer verbatim
//
// Nothing here trims or rewrites model output. A torn-down section is a section
// a tech never reads.

import type { DiagnoseResponse, JobOption } from './types'
import AttachToJob from './attach-to-job'

const ENGINE_LABEL: Record<DiagnoseResponse['source'], string> = {
  cache:       'Previously generated answer, served from the shared diagnostic cache',
  gemini:      'Generated with web grounding',
  anthropic:   'Generated without web grounding',
  unavailable: 'No diagnostic engine was reachable',
}

/** SAFETY WARNINGS first, then the model's own order. */
function orderSections(sections: DiagnoseResponse['sections']) {
  const safety = sections.filter((s) => s.heading.startsWith('SAFETY'))
  const rest   = sections.filter((s) => !s.heading.startsWith('SAFETY'))
  return [...safety, ...rest]
}

export default function ResultPanel({
  result,
  jobs,
}: {
  result: DiagnoseResponse
  jobs: JobOption[]
}) {
  const sections = orderSections(result.sections)

  return (
    <div className="space-y-4">
      {result.hazard && result.usable ? (
        <section className="rounded-xl border border-red-300 bg-red-50 p-4">
          <h3 className="text-sm font-bold uppercase tracking-wide text-red-900">
            Hazard flagged in this procedure
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-red-900/90">
            This diagnostic references high voltage, refrigerant handling, high
            pressure or work with the engine running. Read the SAFETY WARNINGS
            section below in full before you start, and follow your shop&apos;s
            lockout/tagout procedure. Refrigerant work is EPA 608 certified work.
          </p>
        </section>
      ) : null}

      {!result.usable ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h3 className="text-sm font-bold text-amber-900">No diagnostic engine available</h3>
          <p className="mt-1 text-sm leading-relaxed text-amber-900/90">
            This deployment has no AI key configured, so nothing was generated for
            this query. The text below is the standing instruction, not a
            diagnosis. The fault-code decode, gauge readings, VIN decode and parts
            lookup all still work.
          </p>
        </section>
      ) : (
        <section className="rounded-xl border border-slate-300 bg-slate-50 p-4">
          <p className="text-sm leading-relaxed text-slate-700">{result.notice}</p>
        </section>
      )}

      <article className="nwi-card divide-y divide-slate-100">
        {sections.length > 0 ? (
          sections.map((section, i) => (
            <div key={`${section.heading}-${i}`} className="p-4 sm:p-5">
              {section.heading ? (
                <h3
                  className={
                    section.heading.startsWith('SAFETY')
                      ? 'text-xs font-bold uppercase tracking-wider text-red-700'
                      : 'text-xs font-bold uppercase tracking-wider text-slate-500'
                  }
                >
                  {section.heading}
                </h3>
              ) : null}
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                {section.body}
              </p>
            </div>
          ))
        ) : (
          <div className="p-4 sm:p-5">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
              {result.analysis}
            </p>
          </div>
        )}
      </article>

      {result.parts.length > 0 ? (
        <section className="nwi-card p-4 sm:p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Parts on file for this unit
          </h3>
          <ul className="mt-3 space-y-2">
            {result.parts.map((part) => (
              <li key={part.part_number} className="text-sm text-slate-700">
                <span className="font-mono font-semibold text-slate-900">{part.part_number}</span>
                {' — '}
                {part.description}
                {part.field_critical ? (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
                    field critical
                  </span>
                ) : null}
                {part.superseded_by ? (
                  <span className="ml-2 text-xs text-slate-500">
                    superseded by {part.superseded_by}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Reference only. Verify fitment before ordering, and always order the
            current replacement for a superseded number.
          </p>
        </section>
      ) : null}

      <section className="nwi-card p-4 sm:p-5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Where this came from
        </h3>
        <p className="mt-2 text-sm text-slate-700">
          {ENGINE_LABEL[result.source]}
          {result.model ? ` · ${result.model}` : ''}
        </p>

        {result.citations.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {result.citations.map((url) => (
              <li key={url} className="truncate text-sm">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-slate-600 underline hover:text-slate-900"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        ) : result.usable ? (
          <p className="mt-2 text-sm text-slate-500">
            No source citations — this engine does not search the web. Check every
            specification against the OEM service manual.
          </p>
        ) : null}

        <p className="mt-3 text-xs leading-relaxed text-slate-500">{result.disclaimer}</p>
      </section>

      <section className="nwi-card p-4 sm:p-5">
        <AttachToJob
          jobs={jobs}
          note={result.note}
          laborDescription={`Diagnostic — ${result.heading}`}
          enabled={result.usable}
        />
      </section>
    </div>
  )
}

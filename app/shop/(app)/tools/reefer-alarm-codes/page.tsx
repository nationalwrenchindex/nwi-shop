// /shop/tools/reefer-alarm-codes — gated on the shop TYPE, not the user's role.
// requireFeature() is the FIRST statement in the component, so a light-duty shop
// is redirected to /shop before any of this page renders.
//
// The search is a plain GET form against searchParams: no client JavaScript is
// involved, so the page answers on the first paint and a flaky yard connection
// costs a tech a page load rather than a broken tool.

import type { Metadata } from 'next'
import Link from 'next/link'
import PageHeader from '@/components/page-header'
import { requireFeature } from '@/lib/auth'
import { FEATURE_LABELS } from '@/lib/permissions'
import { lookupAlarms, TK_DISCLAIMER } from '@/lib/shop/reefer/lookup'
import AlarmCard from './_components/alarm-card'

export const metadata: Metadata = { title: FEATURE_LABELS.reefer_alarm_codes }

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export default async function ReeferAlarmCodesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireFeature('reefer_alarm_codes')

  const params = await searchParams
  const code = first(params.code).trim()
  const q = first(params.q).trim()
  const manufacturer = first(params.manufacturer).trim()

  // Nothing entered at all means "browse": a manufacturer on its own lists that
  // book. A blank form lists nothing, because 370-odd cards is not an answer.
  const searched = Boolean(code || q || manufacturer)

  const result = searched
    ? await lookupAlarms({ code, q, manufacturer, limit: 120 })
    : null

  return (
    <div className="space-y-6">
      <PageHeader
        title={FEATURE_LABELS.reefer_alarm_codes}
        subtitle="Thermo King and Carrier Transicold alarm codes, merged with the shop's curated diagnostic notes."
      />

      <form method="get" className="nwi-card space-y-4 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
          <div>
            <label className="nwi-label" htmlFor="code">
              Alarm code
            </label>
            <input
              id="code"
              name="code"
              defaultValue={code}
              placeholder="18"
              autoComplete="off"
              inputMode="text"
              // Oversized on purpose — this is the field a tech pokes at with a
              // glove on while reading a controller display.
              className="nwi-input !min-h-14 !text-2xl !font-bold"
            />
          </div>

          <div>
            <label className="nwi-label" htmlFor="q">
              Or search by symptom
            </label>
            <input
              id="q"
              name="q"
              defaultValue={q}
              placeholder="low oil pressure, won't start, high discharge"
              autoComplete="off"
              className="nwi-input !min-h-14 !text-lg"
            />
          </div>

          <div>
            <label className="nwi-label" htmlFor="manufacturer">
              Manufacturer
            </label>
            <select
              id="manufacturer"
              name="manufacturer"
              defaultValue={manufacturer}
              className="nwi-select !min-h-14 !text-lg"
            >
              <option value="">Both</option>
              <option value="TK">Thermo King</option>
              <option value="Carrier">Carrier Transicold</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="submit" className="nwi-btn nwi-btn-primary !min-h-14 !px-8 !text-lg">
            Look up
          </button>
          {searched ? (
            <Link
              href="/shop/tools/reefer-alarm-codes"
              className="nwi-btn nwi-btn-secondary !min-h-14 !text-lg"
            >
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {result?.degraded ? (
        <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
          <p className="text-base font-semibold leading-relaxed text-amber-900">
            Offline mode — the shop&apos;s curated diagnostic notes could not be
            loaded, so these results are the manufacturer operator-manual entries
            only. Code meanings and operator actions below are still correct.
          </p>
        </section>
      ) : null}

      {result === null ? (
        <section className="nwi-card p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">
            Enter a code or a symptom
          </h2>
          <p className="mt-2 text-base leading-relaxed text-slate-600">
            Type the number showing on the controller, or describe what the unit
            is doing. Codes are matched loosely — <span className="font-mono">02</span>,{' '}
            <span className="font-mono">2</span> and{' '}
            <span className="font-mono">AL 02</span> all find the same alarm. Pick a
            manufacturer on its own to page through that book.
          </p>
        </section>
      ) : result.results.length === 0 ? (
        <section className="nwi-card p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">No match</h2>
          <p className="mt-2 text-base leading-relaxed text-slate-600">
            Nothing in the Thermo King or Carrier books matches that. Check the
            code against the controller display, or try a symptom instead — not
            every code applies to every unit.
          </p>
        </section>
      ) : (
        <section className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-wider text-slate-600">
            {result.total} match{result.total === 1 ? '' : 'es'}
            {result.total > result.results.length
              ? ` — showing the first ${result.results.length}`
              : ''}
          </p>
          {result.results.map((alarm, index) => (
            // Index is part of the key on purpose: two curated rows can document
            // the same code for the same family, and a duplicate key would drop
            // one of them from the list.
            <AlarmCard key={`${alarm.group}-${alarm.code}-${index}`} alarm={alarm} />
          ))}
        </section>
      )}

      <section className="nwi-card p-5 sm:p-6">
        <p className="text-sm leading-relaxed text-slate-600">{TK_DISCLAIMER}</p>
      </section>

      <div>
        <Link href="/shop/tools" className="nwi-btn nwi-btn-secondary">
          Back to Tools
        </Link>
      </div>
    </div>
  )
}

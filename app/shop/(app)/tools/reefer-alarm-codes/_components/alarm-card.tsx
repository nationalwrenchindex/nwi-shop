// One merged alarm, rendered for a tablet held at arm's length in a dark yard.
// Type is deliberately large, the severity band is a solid colour block rather
// than a tint, and every field that exists is shown — a tech should not have to
// tap anything to see the diagnostic steps.

import type { ReeferAlarm } from '@/lib/shop/reefer/lookup'

const SEVERITY_STYLES: Record<
  ReeferAlarm['severity'],
  { band: string; border: string; badge: string }
> = {
  immediate_action: {
    band:   'bg-red-700 text-white',
    border: 'border-red-300',
    badge:  'bg-red-700 text-white',
  },
  check_specified: {
    band:   'bg-amber-500 text-slate-900',
    border: 'border-amber-300',
    badge:  'bg-amber-500 text-slate-900',
  },
  ok_to_run: {
    band:   'bg-emerald-700 text-white',
    border: 'border-emerald-300',
    badge:  'bg-emerald-700 text-white',
  },
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="nwi-label">{label}</p>
      <p className="whitespace-pre-line text-base leading-relaxed text-slate-900">
        {value}
      </p>
    </div>
  )
}

export default function AlarmCard({ alarm }: { alarm: ReeferAlarm }) {
  const style = SEVERITY_STYLES[alarm.severity]

  const times = [
    alarm.bookTime !== null ? `Book ${alarm.bookTime} hr` : null,
    alarm.mobileTime !== null ? `Mobile ${alarm.mobileTime} hr` : null,
  ].filter((v): v is string => v !== null)

  return (
    // Not .nwi-card: that rule is unlayered CSS in globals.css and would beat
    // the coloured border utility below.
    <article
      className={`overflow-hidden rounded-xl border-2 bg-white ${style.border}`}
    >
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 ${style.band}`}>
        <span className="font-mono text-3xl font-bold tracking-tight">{alarm.code}</span>
        <span className="text-sm font-bold uppercase tracking-wider">
          {alarm.severityLabel}
        </span>
        <span className="ml-auto text-sm font-semibold">{alarm.groupLabel}</span>
      </div>

      <div className="space-y-4 p-5">
        <h3 className="text-xl font-bold leading-snug text-slate-900">
          {alarm.description}
        </h3>

        {alarm.displayText && alarm.displayText !== alarm.description ? (
          <p className="font-mono text-base text-slate-600">
            Display reads: {alarm.displayText}
          </p>
        ) : null}

        {alarm.safetyWarning ? (
          <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4">
            <p className="text-sm font-bold uppercase tracking-wider text-red-800">
              Safety
            </p>
            <p className="mt-1 text-base font-semibold leading-relaxed text-red-900">
              {alarm.safetyWarning}
            </p>
          </div>
        ) : null}

        {alarm.shorePowerWarning ? (
          <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4">
            <p className="text-base font-bold leading-relaxed text-red-900">
              Shore power hazard — disconnect the standby power cord and lock out
              before working on this unit. The unit can start on its own.
            </p>
          </div>
        ) : null}

        {alarm.meaning ? <Field label="What it means" value={alarm.meaning} /> : null}
        {alarm.operatorAction ? (
          <Field label="Operator action" value={alarm.operatorAction} />
        ) : null}
        {alarm.commonCauses ? (
          <Field label="Common causes" value={alarm.commonCauses} />
        ) : null}
        {alarm.diagnosticSteps ? (
          <Field label="Diagnostic steps" value={alarm.diagnosticSteps} />
        ) : null}
        {alarm.commonFix ? <Field label="Common fix" value={alarm.commonFix} /> : null}
        {alarm.partsNeeded ? <Field label="Parts needed" value={alarm.partsNeeded} /> : null}
        {alarm.wiringReference ? (
          <Field label="Wiring reference" value={alarm.wiringReference} />
        ) : null}
        {alarm.fieldNotes ? <Field label="Field notes" value={alarm.fieldNotes} /> : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
          <span
            className={`rounded px-2 py-1 text-xs font-bold uppercase tracking-wider ${style.badge}`}
          >
            {alarm.manufacturer}
          </span>
          {alarm.unitFamily ? (
            <span className="rounded bg-slate-200 px-2 py-1 text-xs font-bold uppercase tracking-wider text-slate-800">
              {alarm.unitFamily}
            </span>
          ) : null}
          {times.map((label) => (
            <span
              key={label}
              className="rounded bg-slate-900 px-2 py-1 text-xs font-bold uppercase tracking-wider text-white"
            >
              {label}
            </span>
          ))}
          {alarm.source === 'catalog' ? (
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Operator manual entry
            </span>
          ) : null}
        </div>
      </div>
    </article>
  )
}

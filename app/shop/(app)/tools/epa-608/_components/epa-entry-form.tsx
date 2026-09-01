'use client'

// The EPA 608 log entry form.
//
// This is the piece NWI Suite never built: its "+ Log Entry" button rendered a
// panel that said "Full EPA log entry form coming in the next update", so the
// only way a row ever reached hd_epa_log was somebody typing SQL. A refrigerant
// log with no write path is a screen, not a compliance record.
//
// The same validation the API route runs is imported from @/lib/shop/epa, so the
// tech is told what is wrong before the request goes out and the server is not
// relying on that having happened.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  COMMON_REFRIGERANTS,
  EPA_ACTIONS,
  EPA_ACTION_HELP,
  EPA_ACTION_LABELS,
  isValidLogDate,
  isValidPounds,
  toDateInput,
  type EpaAction,
} from '@/lib/shop/epa'
import type { JobOption, TechOption, VehicleOption } from '@/lib/shop/inspections/form-options'

export default function EpaEntryForm({
  jobs,
  vehicles,
  techs,
  currentTechId,
  canLogForOthers,
  defaultCertNumber,
}: {
  jobs:              JobOption[]
  vehicles:          VehicleOption[]
  techs:             TechOption[]
  currentTechId:     string
  /** Managers and foremen may log on behalf of the tech who did the work. */
  canLogForOthers:   boolean
  /** From shop_profiles.epa_cert_number, so nobody retypes it every entry. */
  defaultCertNumber: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const [logDate, setLogDate] = useState(() => toDateInput(new Date()))
  const [jobId, setJobId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [techId, setTechId] = useState(currentTechId)
  const [refrigerant, setRefrigerant] = useState('')
  const [action, setAction] = useState<EpaAction>('recovered')
  const [pounds, setPounds] = useState('')
  const [reason, setReason] = useState('')
  const [certNumber, setCertNumber] = useState(defaultCertNumber)
  const [notes, setNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const poundsValue = pounds.trim() === '' ? 0 : Number(pounds)
  const poundsOk = isValidPounds(poundsValue) && (action === 'leak_test' || poundsValue > 0)
  const canSubmit =
    !saving && refrigerant.trim().length > 0 && poundsOk && isValidLogDate(logDate)

  function reset() {
    // The date, tech and cert number stay put — a tech logging three recoveries
    // in a row should not retype them three times.
    setJobId('')
    setVehicleId('')
    setPounds('')
    setReason('')
    setNotes('')
  }

  function onJobChange(value: string) {
    setJobId(value)
    const job = jobs.find((candidate) => candidate.id === value)
    if (job?.vehicle_id) setVehicleId(job.vehicle_id)
  }

  async function submit() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const response = await fetch('/api/shop/epa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date:                  logDate,
          job_id:                    jobId || null,
          vehicle_id:                vehicleId || null,
          tech_id:                   techId,
          refrigerant_type:          refrigerant,
          action,
          pounds:                    poundsValue,
          reason:                    reason || null,
          tech_certification_number: certNumber || null,
          notes:                     notes || null,
        }),
      })
      const payload: { entry?: { id: string }; error?: string } = await response
        .json()
        .catch(() => ({}))

      if (!response.ok || !payload.entry) {
        setError(payload.error ?? 'Could not save the log entry.')
        return
      }
      setSaved(true)
      reset()
      router.refresh()
    } catch {
      setError('Could not reach the server. Check the connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="nwi-btn nwi-btn-primary" onClick={() => setOpen(true)}>
          Log refrigerant entry
        </button>
        {saved && <span className="text-sm text-emerald-700">Entry saved.</span>}
      </div>
    )
  }

  return (
    <section className="nwi-card p-5">
      <h2 className="text-base font-semibold text-slate-900">Log refrigerant entry</h2>
      <p className="mt-1 text-sm text-slate-600">{EPA_ACTION_HELP[action]}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="nwi-label" htmlFor="epa-date">Date</label>
          <input
            id="epa-date"
            type="date"
            className="nwi-input"
            max={toDateInput(new Date())}
            value={logDate}
            onChange={(event) => setLogDate(event.target.value)}
          />
        </div>

        <div>
          <label className="nwi-label" htmlFor="epa-action">Action</label>
          <select
            id="epa-action"
            className="nwi-select"
            value={action}
            onChange={(event) => setAction(event.target.value as EpaAction)}
          >
            {EPA_ACTIONS.map((option) => (
              <option key={option} value={option}>{EPA_ACTION_LABELS[option]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="nwi-label" htmlFor="epa-refrigerant">Refrigerant</label>
          <input
            id="epa-refrigerant"
            className="nwi-input"
            list="epa-refrigerant-options"
            placeholder="R-134a"
            value={refrigerant}
            onChange={(event) => setRefrigerant(event.target.value)}
          />
          {/* Suggestions, not a fixed list — the refrigerant a shop stocks is set
              by regulation and by the supplier, not by us. */}
          <datalist id="epa-refrigerant-options">
            {COMMON_REFRIGERANTS.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="nwi-label" htmlFor="epa-pounds">Pounds</label>
          <input
            id="epa-pounds"
            className="nwi-input"
            inputMode="decimal"
            placeholder={action === 'leak_test' ? '0' : '2.375'}
            value={pounds}
            onChange={(event) => setPounds(event.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            Record what the scale read — nothing is rounded on the way in.
            {action === 'leak_test' ? ' A leak test is normally 0.' : ''}
          </p>
        </div>

        <div>
          <label className="nwi-label" htmlFor="epa-job">Work order (optional)</label>
          <select
            id="epa-job"
            className="nwi-select"
            value={jobId}
            onChange={(event) => onJobChange(event.target.value)}
          >
            <option value="">No work order</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                #{job.job_number}
                {job.description ? ` — ${job.description}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="nwi-label" htmlFor="epa-vehicle">Vehicle / unit</label>
          <select
            id="epa-vehicle"
            className="nwi-select"
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
          >
            <option value="">Shop cylinder / no vehicle</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>{vehicle.label}</option>
            ))}
          </select>
        </div>

        {canLogForOthers && (
          <div>
            <label className="nwi-label" htmlFor="epa-tech">Technician</label>
            <select
              id="epa-tech"
              className="nwi-select"
              value={techId}
              onChange={(event) => setTechId(event.target.value)}
            >
              {techs.map((tech) => (
                <option key={tech.id} value={tech.id}>{tech.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="nwi-label" htmlFor="epa-cert">EPA 608 certification #</label>
          <input
            id="epa-cert"
            className="nwi-input"
            value={certNumber}
            onChange={(event) => setCertNumber(event.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="nwi-label" htmlFor="epa-reason">Reason</label>
          <input
            id="epa-reason"
            className="nwi-input"
            placeholder="Evaporator replacement, leak repair, seasonal service…"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="nwi-label" htmlFor="epa-notes">Notes</label>
          <textarea
            id="epa-notes"
            rows={2}
            className="nwi-input resize-none"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Entry saved. The form is ready for the next one.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="nwi-btn nwi-btn-primary"
          disabled={!canSubmit}
          onClick={submit}
        >
          {saving ? 'Saving…' : 'Save entry'}
        </button>
        <button
          type="button"
          className="nwi-btn nwi-btn-secondary"
          onClick={() => { setOpen(false); setError(null) }}
        >
          Close
        </button>
        {!canSubmit && !saving && (
          <span className="text-xs text-slate-500">
            {refrigerant.trim().length === 0
              ? 'Enter the refrigerant type.'
              : !isValidLogDate(logDate)
                ? 'The date must be a real day, not in the future.'
                : 'Enter the amount in pounds.'}
          </span>
        )}
      </div>
    </section>
  )
}

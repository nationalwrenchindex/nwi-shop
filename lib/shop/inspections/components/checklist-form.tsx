'use client'

// The inspection form, driven entirely by an InspectionFormDef.
//
// One component serves both tools: the 19 CVSA categories and the three aerial
// cadences are the same shape (numbered sections of items, each answered
// Pass/Fail/N/A with a note), so there is one form here rather than two that
// drift. Whatever the server is going to derive on submit is derived here too,
// from the same module, so the tech sees the verdict before they sign it.
//
// It lives beside signature-pad.tsx in lib rather than under one tool's
// `_components/`, because both tools own it equally.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { deriveInspection, emptyAnswers, sectionVerdict } from '../result'
import type {
  CustomerOption,
  JobOption,
  TechOption,
  VehicleOption,
} from '../form-options'
import type { InspectionAnswers, InspectionFormDef, ItemVerdict } from '../types'
import SignaturePad from './signature-pad'

export interface ChecklistFormProps {
  def:               InspectionFormDef
  jobs:              JobOption[]
  vehicles:          VehicleOption[]
  customers:         CustomerOption[]
  techs:             TechOption[]
  currentTechId:     string
  currentTechName:   string
  /** Prefilled from the shop profile so a tech does not retype their cert every time. */
  defaultCertNumber: string
  /** Managers and foremen may file an inspection performed by another tech. */
  canFileForOthers:  boolean
  /** Where "Back" and the post-submit link return to. */
  returnHref:        string
}

const VERDICTS: readonly ItemVerdict[] = ['pass', 'fail', 'na'] as const

const VERDICT_BUTTON: Record<ItemVerdict, string> = {
  pass: 'bg-emerald-600 text-white border-emerald-600',
  fail: 'bg-red-600 text-white border-red-600',
  na:   'bg-slate-500 text-white border-slate-500',
}

const VERDICT_BADGE: Record<ItemVerdict, string> = {
  pass: 'bg-emerald-100 text-emerald-900 ring-emerald-300',
  fail: 'bg-red-100 text-red-900 ring-red-300',
  na:   'bg-slate-200 text-slate-700 ring-slate-300',
}

const VERDICT_LABEL: Record<ItemVerdict, string> = { pass: 'PASS', fail: 'FAIL', na: 'N/A' }

export default function ChecklistForm({
  def,
  jobs,
  vehicles,
  customers,
  techs,
  currentTechId,
  currentTechName,
  defaultCertNumber,
  canFileForOthers,
  returnHref,
}: ChecklistFormProps) {
  const router = useRouter()

  const [answers, setAnswers] = useState<InspectionAnswers>(() => emptyAnswers(def))
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const [jobId, setJobId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [unitNumber, setUnitNumber] = useState('')
  const [licensePlate, setLicensePlate] = useState('')
  const [odometer, setOdometer] = useState('')
  const [carrierName, setCarrierName] = useState('')
  const [carrierAddress, setCarrierAddress] = useState('')
  const [inspectorTechId, setInspectorTechId] = useState(currentTechId)
  const [certNumber, setCertNumber] = useState(defaultCertNumber)
  const [signedOn, setSignedOn] = useState(todayInput)
  const [removedFromService, setRemovedFromService] = useState(false)
  const [signature, setSignature] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filedId, setFiledId] = useState<string | null>(null)

  const derived = useMemo(() => deriveInspection(def, answers), [def, answers])
  const totalItems = useMemo(
    () => def.sections.reduce((sum, section) => sum + section.items.length, 0),
    [def],
  )
  const answered = totalItems - derived.unanswered

  const blockedByCritical = derived.critical && !removedFromService
  const canSubmit =
    !saving && derived.unanswered === 0 && signature !== null && !blockedByCritical

  function setAnswer(sectionId: string, itemId: string, patch: { result?: ItemVerdict; notes?: string }) {
    setAnswers((previous) => ({
      ...previous,
      [sectionId]: {
        ...previous[sectionId],
        [itemId]: { ...previous[sectionId][itemId], ...patch },
      },
    }))
  }

  /** Selecting a work order carries its vehicle and customer across. */
  function onJobChange(value: string) {
    setJobId(value)
    const job = jobs.find((candidate) => candidate.id === value)
    if (!job) return
    if (job.vehicle_id) onVehicleChange(job.vehicle_id)
    if (job.customer_id) setCustomerId(job.customer_id)
  }

  function onVehicleChange(value: string) {
    setVehicleId(value)
    const vehicle = vehicles.find((candidate) => candidate.id === value)
    if (!vehicle) return
    setCustomerId(vehicle.customer_id)
    if (vehicle.unit_number) setUnitNumber(vehicle.unit_number)
    if (vehicle.license) setLicensePlate(vehicle.license)
    if (vehicle.odometer != null) setOdometer(String(vehicle.odometer))
    const customer = customers.find((candidate) => candidate.id === vehicle.customer_id)
    if (customer) {
      // Only fills a blank field — never overwrites something the tech typed.
      setCarrierName((current) => current || customer.label)
      const address = customer.address
      if (address) setCarrierAddress((current) => current || address)
    }
  }

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/shop/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:                  def.type,
          cadence:               def.cadence,
          items:                 answers,
          signature_data:        signature,
          signed_at:             signedOn,
          removed_from_service:  removedFromService,
          job_id:                jobId || null,
          vehicle_id:            vehicleId || null,
          customer_id:           customerId || null,
          unit_number:           unitNumber || null,
          license_plate:         licensePlate || null,
          odometer:              odometer || null,
          carrier_name:          carrierName || null,
          carrier_address:       carrierAddress || null,
          inspector_tech_id:     inspectorTechId,
          inspector_cert_number: certNumber || null,
        }),
      })
      const payload: { inspection?: { id: string }; error?: string } = await response
        .json()
        .catch(() => ({}))

      if (!response.ok || !payload.inspection) {
        setError(payload.error ?? 'Could not file the inspection.')
        return
      }
      setFiledId(payload.inspection.id)
      router.refresh()
    } catch {
      setError('Could not reach the server. Check the connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  if (filedId) {
    return (
      <section className="nwi-card p-5 sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">Inspection filed</h2>
        <p className="mt-2 text-sm text-slate-600">
          The record is signed and locked. It cannot be edited — a correction is a
          new inspection, the same as it would be on paper.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <a
            className="nwi-btn nwi-btn-primary"
            href={`/api/shop/inspections/${filedId}/report`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open printable report
          </a>
          <Link className="nwi-btn nwi-btn-secondary" href={returnHref}>
            Back to inspections
          </Link>
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── Progress ─────────────────────────────────────────────────────── */}
      <section className="nwi-card sticky top-0 z-10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {answered} of {totalItems} items answered
            </p>
            <p className="text-xs text-slate-500">
              {derived.deficiencies.length === 0
                ? 'No deficiencies recorded yet.'
                : `${derived.deficiencies.length} deficienc${
                    derived.deficiencies.length === 1 ? 'y' : 'ies'
                  }${derived.critical ? ' — one or more is safety critical' : ''}`}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${
              derived.unanswered > 0
                ? 'bg-slate-200 text-slate-700 ring-slate-300'
                : VERDICT_BADGE[derived.result]
            }`}
          >
            {derived.unanswered > 0 ? 'INCOMPLETE' : VERDICT_LABEL[derived.result]}
          </span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-slate-900 transition-all"
            style={{ width: `${totalItems === 0 ? 0 : (answered / totalItems) * 100}%` }}
          />
        </div>
      </section>

      {/* ── Unit and inspector ───────────────────────────────────────────── */}
      <section className="nwi-card p-5">
        <h2 className="text-base font-semibold text-slate-900">Unit &amp; inspector</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="nwi-label" htmlFor="insp-job">Work order (optional)</label>
            <select
              id="insp-job"
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
            <label className="nwi-label" htmlFor="insp-vehicle">Vehicle / unit</label>
            <select
              id="insp-vehicle"
              className="nwi-select"
              value={vehicleId}
              onChange={(event) => onVehicleChange(event.target.value)}
            >
              <option value="">Not linked to a vehicle record</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>{vehicle.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="nwi-label" htmlFor="insp-customer">Customer</label>
            <select
              id="insp-customer"
              className="nwi-select"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">No customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="nwi-label" htmlFor="insp-unit">Unit number</label>
            <input
              id="insp-unit"
              className="nwi-input"
              value={unitNumber}
              onChange={(event) => setUnitNumber(event.target.value)}
              placeholder="Printed on the certificate"
            />
          </div>

          <div>
            <label className="nwi-label" htmlFor="insp-plate">License plate</label>
            <input
              id="insp-plate"
              className="nwi-input"
              value={licensePlate}
              onChange={(event) => setLicensePlate(event.target.value)}
            />
          </div>

          <div>
            <label className="nwi-label" htmlFor="insp-odo">
              {def.type === 'dot' ? 'Odometer' : 'Hour meter'}
            </label>
            <input
              id="insp-odo"
              className="nwi-input"
              inputMode="numeric"
              value={odometer}
              onChange={(event) => setOdometer(event.target.value)}
            />
          </div>

          <div>
            <label className="nwi-label" htmlFor="insp-carrier">
              {def.type === 'dot' ? 'Carrier name' : 'Owner / operator'}
            </label>
            <input
              id="insp-carrier"
              className="nwi-input"
              value={carrierName}
              onChange={(event) => setCarrierName(event.target.value)}
            />
          </div>

          <div>
            <label className="nwi-label" htmlFor="insp-carrier-address">Carrier address</label>
            <input
              id="insp-carrier-address"
              className="nwi-input"
              value={carrierAddress}
              onChange={(event) => setCarrierAddress(event.target.value)}
            />
          </div>

          <div>
            <label className="nwi-label" htmlFor="insp-inspector">Inspector</label>
            {canFileForOthers ? (
              <select
                id="insp-inspector"
                className="nwi-select"
                value={inspectorTechId}
                onChange={(event) => setInspectorTechId(event.target.value)}
              >
                {techs.map((tech) => (
                  <option key={tech.id} value={tech.id}>{tech.name}</option>
                ))}
              </select>
            ) : (
              // A tech signs as themselves. The name on a certification is not a
              // free-text field, so it is shown rather than offered for editing.
              <input id="insp-inspector" className="nwi-input" value={currentTechName} disabled readOnly />
            )}
          </div>

          <div>
            <label className="nwi-label" htmlFor="insp-cert">
              Inspector certification #{def.requiresInspectorCert ? '' : ' (optional)'}
            </label>
            <input
              id="insp-cert"
              className="nwi-input"
              value={certNumber}
              onChange={(event) => setCertNumber(event.target.value)}
            />
          </div>

          <div>
            <label className="nwi-label" htmlFor="insp-date">Date performed</label>
            <input
              id="insp-date"
              type="date"
              className="nwi-input"
              max={todayInput()}
              value={signedOn}
              onChange={(event) => setSignedOn(event.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              The date on the certificate. Back-date a paper inspection typed in later —
              the record separately stores when it was filed.
            </p>
          </div>
        </div>
      </section>

      {/* ── Checklist ────────────────────────────────────────────────────── */}
      {def.sections.map((section) => {
        const isCollapsed = collapsed[section.id] === true
        const verdict = sectionVerdict(def, section.id, answers)
        const unansweredHere = section.items.filter(
          (item) => answers[section.id]?.[item.id]?.result === '',
        ).length

        return (
          <section key={section.id} className="nwi-card overflow-hidden">
            <button
              type="button"
              onClick={() =>
                setCollapsed((previous) => ({ ...previous, [section.id]: !isCollapsed }))
              }
              className="flex w-full items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left"
            >
              <span className="w-6 shrink-0 text-right font-mono text-xs text-slate-400">
                {section.num}
              </span>
              <span className="flex-1 text-sm font-semibold text-slate-900">{section.label}</span>
              {unansweredHere > 0 ? (
                <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                  {unansweredHere} left
                </span>
              ) : (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${VERDICT_BADGE[verdict]}`}
                >
                  {VERDICT_LABEL[verdict]}
                </span>
              )}
              <span aria-hidden className="text-xs text-slate-400">
                {isCollapsed ? '▸' : '▾'}
              </span>
            </button>

            {!isCollapsed && (
              <ul>
                {section.items.map((item) => {
                  const state = answers[section.id]?.[item.id] ?? { result: '' as const, notes: '' }
                  const failed = state.result === 'fail'
                  return (
                    <li
                      key={item.id}
                      className={`border-b border-slate-100 last:border-b-0 ${failed ? 'bg-red-50' : ''}`}
                    >
                      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                        <div className="min-w-[12rem] flex-1">
                          <p className="text-sm leading-snug text-slate-700">{item.label}</p>
                          {item.safetyCritical && (
                            <span className="mt-1 inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-red-800">
                              SAFETY CRITICAL
                            </span>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {VERDICTS.map((verdictOption) => (
                            <button
                              key={verdictOption}
                              type="button"
                              onClick={() => setAnswer(section.id, item.id, { result: verdictOption })}
                              aria-pressed={state.result === verdictOption}
                              className={`min-h-[2.5rem] w-14 rounded-md border text-xs font-bold ${
                                state.result === verdictOption
                                  ? VERDICT_BUTTON[verdictOption]
                                  : 'border-slate-300 bg-white text-slate-500'
                              }`}
                            >
                              {VERDICT_LABEL[verdictOption]}
                            </button>
                          ))}
                        </div>
                      </div>
                      {failed && (
                        <div className="px-4 pb-3">
                          <label className="sr-only" htmlFor={`note-${section.id}-${item.id}`}>
                            Describe the deficiency
                          </label>
                          <textarea
                            id={`note-${section.id}-${item.id}`}
                            rows={2}
                            value={state.notes}
                            onChange={(event) =>
                              setAnswer(section.id, item.id, { notes: event.target.value })
                            }
                            placeholder="Describe the deficiency found — this prints on the report."
                            className="nwi-input resize-none border-red-300 bg-white"
                          />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}

      {/* ── Sign-off ─────────────────────────────────────────────────────── */}
      <section className="nwi-card p-5">
        <h2 className="text-base font-semibold text-slate-900">Sign and file</h2>
        <p className="mt-1 text-sm text-slate-600">{def.requirement}</p>

        {derived.critical && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-900">
              A safety-critical item failed.
            </p>
            <p className="mt-1 text-sm text-red-900/90">
              {def.type === 'dot'
                ? 'Under 49 CFR 396.9 this unit may not be operated until the defect is repaired.'
                : 'Under OSHA 1926.453 this machine may not be operated until the defect is repaired.'}{' '}
              Confirm removal from service below before filing.
            </p>
          </div>
        )}

        <label className="mt-4 flex items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 rounded border-slate-300"
            checked={removedFromService}
            onChange={(event) => setRemovedFromService(event.target.checked)}
          />
          <span>
            This unit was removed from service at the time of inspection.
          </span>
        </label>

        <div className="mt-5">
          <span className="nwi-label">Inspector signature</span>
          <SignaturePad onChange={setSignature} />
          <p className="mt-2 text-xs text-slate-500">
            A signature is required. The record is locked the moment it is filed and
            cannot be edited afterwards.
          </p>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="nwi-btn nwi-btn-primary"
            disabled={!canSubmit}
            onClick={submit}
          >
            {saving ? 'Filing…' : 'Sign and file inspection'}
          </button>
          <Link href={returnHref} className="nwi-btn nwi-btn-secondary">
            Cancel
          </Link>
          {!canSubmit && !saving && (
            <span className="text-xs text-slate-500">
              {derived.unanswered > 0
                ? `${derived.unanswered} item${derived.unanswered === 1 ? '' : 's'} still unanswered.`
                : blockedByCritical
                  ? 'Confirm removal from service to continue.'
                  : 'Add a signature to continue.'}
            </span>
          )}
        </div>
      </section>
    </div>
  )
}

/** `YYYY-MM-DD` in the tech's own timezone, for the date input. */
function todayInput(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

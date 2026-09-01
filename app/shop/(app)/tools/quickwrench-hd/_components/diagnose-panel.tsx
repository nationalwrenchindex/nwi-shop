'use client'

// Symptom / fault diagnosis. Three domains, because the engine behind them uses
// three different field-knowledge corpora and they must not be mixed — a
// Thermo King part number has no business in a Detroit DD15 answer, and the
// prompts say so explicitly.
//
// The VIN decode is deliberately part of this panel rather than its own tab: a
// vehicle-specific answer is a materially better answer, and the fastest way to
// get year/make/model/engine right is to read it off the VIN plate.

import { useState } from 'react'
import {
  getJson,
  postJson,
  type DiagnoseResponse,
  type EngineStatus,
  type JobOption,
  type VehicleDecode,
} from './types'
import ResultPanel from './result-panel'

const TRUCK_BRANDS = [
  'Cummins', 'Detroit Diesel', 'PACCAR', 'Mercedes-Benz',
  'Caterpillar', 'Volvo', 'Mack', 'International',
]

const REEFER_MANUFACTURERS = ['Thermo King', 'Carrier Transicold']

const ELECTRICAL_TOPICS = [
  'Charging system', 'Starting system', 'Sensors and senders',
  'Relays and fuses', 'CAN bus and modules', 'Wiring and connectors',
  'Grounds', 'Lighting and trailer harness',
]

type Domain = 'truck' | 'reefer' | 'electrical'

export default function DiagnosePanel({
  jobs,
  engine,
}: {
  jobs: JobOption[]
  engine: EngineStatus
}) {
  const [domain, setDomain] = useState<Domain>('truck')

  // Truck
  const [truckBrand, setTruckBrand] = useState('Cummins')
  const [engineModel, setEngineModel] = useState('')
  const [spn, setSpn] = useState('')
  const [fmi, setFmi] = useState('')
  const [vin, setVin] = useState('')
  const [vehicleYear, setVehicleYear] = useState('')
  const [vehicleMake, setVehicleMake] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [vinStatus, setVinStatus] = useState<string | null>(null)

  // Reefer
  const [manufacturer, setManufacturer] = useState('Thermo King')
  const [unitModel, setUnitModel] = useState('')
  const [alarmCode, setAlarmCode] = useState('')

  // Electrical
  const [topic, setTopic] = useState('')
  const [question, setQuestion] = useState('')

  // Shared
  const [symptom, setSymptom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DiagnoseResponse | null>(null)

  async function decodeVin() {
    const trimmed = vin.trim().toUpperCase()
    if (trimmed.length !== 17) {
      setVinStatus('A VIN is 17 characters.')
      return
    }
    setVinStatus('Decoding…')
    try {
      const data = await getJson<{ vehicle: VehicleDecode }>(
        `/api/shop/tools/quickwrench-hd/vin/${encodeURIComponent(trimmed)}`,
      )
      setVehicleYear(data.vehicle.year)
      setVehicleMake(data.vehicle.make)
      setVehicleModel(data.vehicle.model)
      if (data.vehicle.engine && !engineModel) setEngineModel(data.vehicle.engine)
      setVinStatus(
        `${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model}`.trim() || 'Decoded.',
      )
    } catch (err) {
      setVinStatus(err instanceof Error ? err.message : 'VIN decode failed.')
    }
  }

  function buildBody(): Record<string, unknown> | string {
    if (domain === 'truck') {
      if (!engineModel.trim()) return 'Enter the engine model.'
      if (!spn.trim() && !fmi.trim() && !symptom.trim()) {
        return 'Enter an SPN, an FMI, or describe the symptom.'
      }
      return {
        domain: 'truck',
        truckBrand,
        engineModel: engineModel.trim(),
        spn: spn.trim() || undefined,
        fmi: fmi.trim() || undefined,
        symptom: symptom.trim() || undefined,
        vehicleYear: vehicleYear.trim() || undefined,
        vehicleMake: vehicleMake.trim() || undefined,
        vehicleModel: vehicleModel.trim() || undefined,
      }
    }
    if (domain === 'reefer') {
      if (!unitModel.trim()) return 'Enter the unit model.'
      if (!alarmCode.trim() && !symptom.trim()) {
        return 'Enter an alarm code or describe the symptom.'
      }
      return {
        domain: 'reefer',
        manufacturer,
        model: unitModel.trim(),
        alarmCode: alarmCode.trim() || undefined,
        symptom: symptom.trim() || undefined,
      }
    }
    if (!question.trim()) return 'Enter the question.'
    return { domain: 'electrical', topic: topic || undefined, question: question.trim() }
  }

  async function run() {
    const body = buildBody()
    if (typeof body === 'string') {
      setError(body)
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await postJson<DiagnoseResponse>('/api/shop/tools/quickwrench-hd/diagnose', body))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The diagnostic failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {engine.primary === null ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h3 className="text-sm font-bold text-amber-900">AI diagnosis is not configured</h3>
          <p className="mt-1 text-sm leading-relaxed text-amber-900/90">
            No model key is set on this deployment, so this panel cannot generate
            a diagnostic. Fault-code decode, gauge readings, VIN decode and parts
            lookup do not need one and are fully working.
          </p>
        </section>
      ) : null}

      <section className="nwi-card p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          {(['truck', 'reefer', 'electrical'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => { setDomain(d); setError(null) }}
              className={
                domain === d
                  ? 'nwi-btn nwi-btn-primary'
                  : 'nwi-btn nwi-btn-secondary'
              }
            >
              {d === 'truck' ? 'Truck engine' : d === 'reefer' ? 'Reefer unit' : 'Electrical'}
            </button>
          ))}
        </div>

        {domain === 'truck' ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="nwi-label" htmlFor="qwhd-vin">VIN (optional)</label>
                <input
                  id="qwhd-vin"
                  className="nwi-input font-mono uppercase"
                  maxLength={17}
                  value={vin}
                  onChange={(e) => setVin(e.target.value)}
                  placeholder="17 characters"
                />
              </div>
              <div className="flex items-end">
                <button type="button" className="nwi-btn nwi-btn-secondary" onClick={decodeVin}>
                  Decode VIN
                </button>
              </div>
            </div>
            {vinStatus ? <p className="text-sm text-slate-600">{vinStatus}</p> : null}

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="nwi-label" htmlFor="qwhd-year">Year</label>
                <input id="qwhd-year" className="nwi-input" value={vehicleYear}
                  onChange={(e) => setVehicleYear(e.target.value)} />
              </div>
              <div>
                <label className="nwi-label" htmlFor="qwhd-make">Make</label>
                <input id="qwhd-make" className="nwi-input" value={vehicleMake}
                  onChange={(e) => setVehicleMake(e.target.value)} />
              </div>
              <div>
                <label className="nwi-label" htmlFor="qwhd-vmodel">Model</label>
                <input id="qwhd-vmodel" className="nwi-input" value={vehicleModel}
                  onChange={(e) => setVehicleModel(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="nwi-label" htmlFor="qwhd-brand">Engine brand</label>
                <select id="qwhd-brand" className="nwi-select" value={truckBrand}
                  onChange={(e) => setTruckBrand(e.target.value)}>
                  {TRUCK_BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="nwi-label" htmlFor="qwhd-engine">Engine model</label>
                <input id="qwhd-engine" className="nwi-input" placeholder="DD15, ISX, MX-13…"
                  value={engineModel} onChange={(e) => setEngineModel(e.target.value)} />
              </div>
              <div>
                <label className="nwi-label" htmlFor="qwhd-spn">SPN</label>
                <input id="qwhd-spn" className="nwi-input" inputMode="numeric"
                  value={spn} onChange={(e) => setSpn(e.target.value)} />
              </div>
              <div>
                <label className="nwi-label" htmlFor="qwhd-fmi">FMI</label>
                <input id="qwhd-fmi" className="nwi-input" inputMode="numeric"
                  value={fmi} onChange={(e) => setFmi(e.target.value)} />
              </div>
            </div>
          </div>
        ) : null}

        {domain === 'reefer' ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="nwi-label" htmlFor="qwhd-mfr">Manufacturer</label>
              <select id="qwhd-mfr" className="nwi-select" value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}>
                {REEFER_MANUFACTURERS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="nwi-label" htmlFor="qwhd-umodel">Unit model</label>
              <input id="qwhd-umodel" className="nwi-input" placeholder="S-600, X4 7300…"
                value={unitModel} onChange={(e) => setUnitModel(e.target.value)} />
            </div>
            <div>
              <label className="nwi-label" htmlFor="qwhd-alarm">Alarm code</label>
              <input id="qwhd-alarm" className="nwi-input" value={alarmCode}
                onChange={(e) => setAlarmCode(e.target.value)} />
            </div>
          </div>
        ) : null}

        {domain === 'electrical' ? (
          <div className="mt-4 space-y-3">
            <div>
              <label className="nwi-label" htmlFor="qwhd-topic">Topic (optional)</label>
              <select id="qwhd-topic" className="nwi-select" value={topic}
                onChange={(e) => setTopic(e.target.value)}>
                <option value="">No topic</option>
                {ELECTRICAL_TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="nwi-label" htmlFor="qwhd-question">Question</label>
              <textarea
                id="qwhd-question"
                className="nwi-input min-h-24"
                rows={4}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What are you seeing, and what have you already checked?"
              />
            </div>
          </div>
        ) : null}

        {domain !== 'electrical' ? (
          <div className="mt-4">
            <label className="nwi-label" htmlFor="qwhd-symptom">Symptom (optional if a code is entered)</label>
            <textarea
              id="qwhd-symptom"
              className="nwi-input min-h-24"
              rows={3}
              value={symptom}
              onChange={(e) => setSymptom(e.target.value)}
              placeholder="Cranks but will not fire, derates after 20 minutes, no cooling on high speed…"
            />
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="nwi-btn nwi-btn-primary"
            onClick={run}
            disabled={busy || engine.primary === null}
          >
            {busy ? 'Working…' : 'Run diagnostic'}
          </button>
          {busy ? (
            <span className="text-sm text-slate-500">
              This can take 20 seconds or so. Leave the page open.
            </span>
          ) : null}
        </div>

        {error ? <p className="mt-3 text-sm font-medium text-red-700">{error}</p> : null}
      </section>

      {result ? <ResultPanel result={result} jobs={jobs} /> : null}
    </div>
  )
}

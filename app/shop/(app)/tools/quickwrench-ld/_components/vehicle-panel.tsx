'use client'

// The vehicle every other panel works from. Two ways in: decode a VIN (NHTSA
// vPIC, no API key needed) or type year/make/model. Both are always available —
// a 1994 pickup will not decode, and the tech still needs the tool.

import { useState } from 'react'
import type { LdVehicle } from '@/lib/shop/quickwrench/ld'
import { getJson, LD_API } from './client-api'
import { EMPTY_VEHICLE, type JobOption, type WorkVehicle } from './types'
import { Notice, Panel } from './ui'

interface VinResponse {
  vehicle: LdVehicle
  message: string | null
}

export default function VehiclePanel({
  vehicle,
  onChange,
  jobs,
}: {
  vehicle:  WorkVehicle
  onChange: (next: WorkVehicle) => void
  jobs:     JobOption[]
}) {
  const [decoding, setDecoding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const set = (patch: Partial<WorkVehicle>) => onChange({ ...vehicle, ...patch })

  const jobsWithVehicles = jobs.filter((j) => j.vehicle !== null)

  async function decode() {
    const vin = vehicle.vin.trim().toUpperCase()
    setError(null)
    setNote(null)

    if (vin.length !== 17) {
      setError('A VIN is 17 characters. Type the year, make and model instead if you do not have one.')
      return
    }

    setDecoding(true)
    const result = await getJson<VinResponse>(`${LD_API}/vin/${encodeURIComponent(vin)}`)
    setDecoding(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    const v = result.data.vehicle
    onChange({
      vin:    v.vin,
      year:   v.year,
      make:   v.make,
      model:  v.model,
      engine: v.engine === 'N/A' ? '' : v.engine,
      trim:   v.trim ?? '',
    })
    setNote(result.data.message)
  }

  function loadFromJob(jobId: string) {
    const job = jobs.find((j) => j.id === jobId)
    setError(null)
    setNote(null)
    if (job?.vehicle) onChange(job.vehicle)
  }

  return (
    <Panel
      title="Vehicle"
      subtitle="Decode a VIN or type the year, make and model. Everything below runs against this vehicle."
    >
      <div className="space-y-4">
        {jobsWithVehicles.length > 0 ? (
          <div>
            <label className="nwi-label" htmlFor="qwld-job-vehicle">
              Pull from an open job
            </label>
            <select
              id="qwld-job-vehicle"
              className="nwi-select"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) loadFromJob(e.target.value)
              }}
            >
              <option value="">Select a job to copy its vehicle</option>
              {jobsWithVehicles.map((job) => (
                <option key={job.id} value={job.id}>
                  #{job.job_number} — {job.vehicle?.year} {job.vehicle?.make} {job.vehicle?.model}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label className="nwi-label" htmlFor="qwld-vin">
              VIN
            </label>
            <input
              id="qwld-vin"
              className="nwi-input font-mono uppercase"
              maxLength={17}
              autoComplete="off"
              spellCheck={false}
              placeholder="17 characters"
              value={vehicle.vin}
              onChange={(e) => set({ vin: e.target.value.toUpperCase() })}
            />
          </div>
          <button
            type="button"
            className="nwi-btn nwi-btn-primary"
            onClick={decode}
            disabled={decoding}
          >
            {decoding ? 'Decoding…' : 'Decode VIN'}
          </button>
          <button
            type="button"
            className="nwi-btn nwi-btn-secondary"
            onClick={() => {
              onChange(EMPTY_VEHICLE)
              setError(null)
              setNote(null)
            }}
            disabled={decoding}
          >
            Clear
          </button>
        </div>

        {error ? <Notice tone="danger">{error}</Notice> : null}
        {note ? <Notice tone="warning">{note}</Notice> : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="nwi-label" htmlFor="qwld-year">Year</label>
            <input
              id="qwld-year"
              className="nwi-input"
              inputMode="numeric"
              value={vehicle.year}
              onChange={(e) => set({ year: e.target.value })}
            />
          </div>
          <div>
            <label className="nwi-label" htmlFor="qwld-make">Make</label>
            <input
              id="qwld-make"
              className="nwi-input"
              value={vehicle.make}
              onChange={(e) => set({ make: e.target.value })}
            />
          </div>
          <div>
            <label className="nwi-label" htmlFor="qwld-model">Model</label>
            <input
              id="qwld-model"
              className="nwi-input"
              value={vehicle.model}
              onChange={(e) => set({ model: e.target.value })}
            />
          </div>
          <div>
            <label className="nwi-label" htmlFor="qwld-engine">Engine</label>
            <input
              id="qwld-engine"
              className="nwi-input"
              placeholder="5.3L 8-cyl"
              value={vehicle.engine}
              onChange={(e) => set({ engine: e.target.value })}
            />
          </div>
          <div>
            <label className="nwi-label" htmlFor="qwld-trim">Trim</label>
            <input
              id="qwld-trim"
              className="nwi-input"
              value={vehicle.trim}
              onChange={(e) => set({ trim: e.target.value })}
            />
          </div>
        </div>
      </div>
    </Panel>
  )
}

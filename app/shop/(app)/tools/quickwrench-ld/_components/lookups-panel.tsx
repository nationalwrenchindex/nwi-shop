'use client'

// Reference lookups for the current vehicle.
//
// Recalls and complaints come from NHTSA and need no API key — they stay usable
// on a deployment with no GEMINI_API_KEY. Tire and fluid specs are AI-generated
// and are disabled with an explanation when the key is absent.

import { useState } from 'react'
import {
  NHTSA_DISCLAIMER,
  type LdFluidSpecs,
  type LdTechGuide,
  type LdTireSpecs,
} from '@/lib/shop/quickwrench/ld'
import type { LdComplaintGroup, LdRecall } from '@/lib/shop/quickwrench/ld-nhtsa'
import { getJson, LD_API, postJson } from './client-api'
import { vehicleIsIdentified, type WorkVehicle } from './types'
import { AiDisclaimer, Bullets, Citations, Field, Notice, Panel, Spinner, Steps } from './ui'

type Tab = 'recalls' | 'complaints' | 'tire' | 'fluid' | 'guide'

const TABS: { id: Tab; label: string; needsAi: boolean }[] = [
  { id: 'recalls',    label: 'Recalls',      needsAi: false },
  { id: 'complaints', label: 'Complaints',   needsAi: false },
  { id: 'tire',       label: 'Tire specs',   needsAi: true  },
  { id: 'fluid',      label: 'Fluid specs',  needsAi: true  },
  { id: 'guide',      label: 'Repair guide', needsAi: true  },
]

interface RecallsResponse {
  recalls: LdRecall[]
  count:   number
  message: string | null
}

interface ComplaintsResponse {
  groups:  LdComplaintGroup[]
  total:   number
  message: string | null
}

interface TireResponse  { specs: LdTireSpecs;  citations: string[] }
interface FluidResponse { specs: LdFluidSpecs; citations: string[] }
interface GuideResponse { guide: LdTechGuide;  citations: string[] }

export default function LookupsPanel({
  vehicle,
  aiEnabled,
}: {
  vehicle:   WorkVehicle
  aiEnabled: boolean
}) {
  const [tab, setTab] = useState<Tab>('recalls')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [recalls, setRecalls] = useState<RecallsResponse | null>(null)
  const [complaints, setComplaints] = useState<ComplaintsResponse | null>(null)
  const [tire, setTire] = useState<TireResponse | null>(null)
  const [fluid, setFluid] = useState<FluidResponse | null>(null)
  const [guide, setGuide] = useState<GuideResponse | null>(null)
  const [guideJob, setGuideJob] = useState('')

  const identified = vehicleIsIdentified(vehicle)
  const query = new URLSearchParams({
    year:  vehicle.year,
    make:  vehicle.make,
    model: vehicle.model,
  }).toString()

  async function load() {
    setError(null)

    if (tab === 'guide' && guideJob.trim() === '') {
      setError('Name the repair you want a guide for, e.g. "Front brake pad and rotor replacement".')
      return
    }

    setBusy(true)

    if (tab === 'recalls') {
      const r = await getJson<RecallsResponse>(`${LD_API}/recalls?${query}`)
      if (r.ok) setRecalls(r.data)
      else setError(r.error)
    } else if (tab === 'complaints') {
      const r = await getJson<ComplaintsResponse>(`${LD_API}/complaints?${query}`)
      if (r.ok) setComplaints(r.data)
      else setError(r.error)
    } else if (tab === 'tire') {
      const r = await postJson<TireResponse>(`${LD_API}/tire-specs`, {
        year: vehicle.year, make: vehicle.make, model: vehicle.model,
        trim: vehicle.trim, engine: vehicle.engine,
      })
      if (r.ok) setTire(r.data)
      else setError(r.error)
    } else if (tab === 'fluid') {
      const r = await postJson<FluidResponse>(`${LD_API}/fluid-specs`, {
        year: vehicle.year, make: vehicle.make, model: vehicle.model,
        engine: vehicle.engine,
      })
      if (r.ok) setFluid(r.data)
      else setError(r.error)
    } else {
      const r = await postJson<GuideResponse>(`${LD_API}/tech-guide`, {
        year: vehicle.year, make: vehicle.make, model: vehicle.model,
        engine: vehicle.engine, job: guideJob.trim(),
      })
      if (r.ok) setGuide(r.data)
      else setError(r.error)
    }

    setBusy(false)
  }

  const active = TABS.find((t) => t.id === tab)
  const blockedByAi = !!active?.needsAi && !aiEnabled

  return (
    <Panel title="Reference" subtitle="Recalls, known complaints and OEM specs for this vehicle.">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTab(t.id); setError(null) }}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                tab === t.id
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'guide' ? (
          <div>
            <label className="nwi-label" htmlFor="qwld-guide-job">Repair</label>
            <input
              id="qwld-guide-job"
              className="nwi-input"
              placeholder="Front brake pad and rotor replacement"
              value={guideJob}
              onChange={(e) => setGuideJob(e.target.value)}
            />
          </div>
        ) : null}

        <button
          type="button"
          className="nwi-btn nwi-btn-primary"
          onClick={load}
          disabled={!identified || busy || blockedByAi}
        >
          {busy ? 'Loading…' : `Load ${active?.label.toLowerCase()}`}
        </button>

        {!identified ? (
          <Notice tone="info">Enter a year, make and model above to run a lookup.</Notice>
        ) : null}

        {blockedByAi ? (
          <Notice tone="warning" title="Needs GEMINI_API_KEY">
            Tire and fluid specs are AI-generated, so they cannot run on this
            deployment. Recalls and complaints come from NHTSA and still work.
          </Notice>
        ) : null}

        {busy ? <Spinner label="Loading…" /> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {tab === 'recalls'    && recalls    ? <RecallsView data={recalls} /> : null}
        {tab === 'complaints' && complaints ? <ComplaintsView data={complaints} /> : null}
        {tab === 'tire'       && tire       ? <TireView data={tire} /> : null}
        {tab === 'fluid'      && fluid      ? <FluidView data={fluid} /> : null}
        {tab === 'guide'      && guide      ? <GuideView data={guide} /> : null}
      </div>
    </Panel>
  )
}

function NhtsaFooter() {
  return <p className="text-xs leading-relaxed text-slate-500">{NHTSA_DISCLAIMER}</p>
}

function RecallsView({ data }: { data: RecallsResponse }) {
  if (data.recalls.length === 0) {
    return (
      <div className="space-y-3">
        <Notice tone="info">{data.message ?? 'No recall campaigns returned.'}</Notice>
        <NhtsaFooter />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {data.count} recall {data.count === 1 ? 'campaign' : 'campaigns'} on file.
      </p>
      <ul className="space-y-3">
        {data.recalls.map((r, i) => (
          <li key={r.campaignNumber || `recall-${i}`} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-sm font-semibold text-slate-900">
                {r.campaignNumber || 'Campaign number not given'}
              </p>
              {r.reportDate ? <p className="text-xs text-slate-500">{r.reportDate}</p> : null}
            </div>
            {r.component ? (
              <p className="mt-1 text-sm font-medium text-slate-700">{r.component}</p>
            ) : null}
            {r.summary ? <p className="mt-2 text-sm text-slate-600">{r.summary}</p> : null}
            {r.consequence ? (
              <p className="mt-2 text-sm text-red-800">Consequence: {r.consequence}</p>
            ) : null}
            {r.remedy ? <p className="mt-2 text-sm text-slate-600">Remedy: {r.remedy}</p> : null}
          </li>
        ))}
      </ul>
      <NhtsaFooter />
    </div>
  )
}

function ComplaintsView({ data }: { data: ComplaintsResponse }) {
  if (data.groups.length === 0) {
    return (
      <div className="space-y-3">
        <Notice tone="info">{data.message ?? 'No complaints returned.'}</Notice>
        <NhtsaFooter />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {data.total} owner {data.total === 1 ? 'complaint' : 'complaints'} on file, grouped by
        component. These are owner reports, not manufacturer service bulletins.
      </p>
      <ul className="space-y-2">
        {data.groups.map((g) => {
          const crashes = g.complaints.filter((c) => c.crash).length
          const fires   = g.complaints.filter((c) => c.fire).length
          const sample  = g.complaints.find((c) => c.summary !== '')
          return (
            <li key={g.component} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{g.component}</p>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                  {g.count}
                </span>
              </div>
              {crashes > 0 || fires > 0 ? (
                <p className="mt-1 text-xs font-semibold text-red-700">
                  {crashes > 0 ? `${crashes} involving a crash` : ''}
                  {crashes > 0 && fires > 0 ? ' · ' : ''}
                  {fires > 0 ? `${fires} involving a fire` : ''}
                </p>
              ) : null}
              {sample ? (
                <p className="mt-2 line-clamp-4 text-sm text-slate-600">{sample.summary}</p>
              ) : null}
            </li>
          )
        })}
      </ul>
      <NhtsaFooter />
    </div>
  )
}

function TireView({ data }: { data: TireResponse }) {
  const s = data.specs
  return (
    <div className="space-y-4">
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Front tire" value={s.tire_size_front} />
        <Field label="Rear tire" value={s.tire_size_rear} />
        <Field label="Wheel size" value={s.wheel_size} />
        <Field label="Bolt pattern" value={s.bolt_pattern} />
        <Field
          label="Lug torque"
          value={s.lug_torque_lb_ft === null ? null : `${s.lug_torque_lb_ft} lb-ft`}
        />
        <Field
          label="Front pressure"
          value={s.tire_pressure_front_psi === null ? null : `${s.tire_pressure_front_psi} psi`}
        />
        <Field
          label="Rear pressure"
          value={s.tire_pressure_rear_psi === null ? null : `${s.tire_pressure_rear_psi} psi`}
        />
        <Field label="Load / speed" value={s.load_speed_rating} />
      </div>
      <Notice tone="warning" title="Lug torque">
        Torque to the door-jamb or service-manual value, not to this number, and
        retorque after 50 miles.
      </Notice>
      <Citations urls={data.citations} />
      <AiDisclaimer />
    </div>
  )
}

function FluidView({ data }: { data: FluidResponse }) {
  const s = data.specs
  return (
    <div className="space-y-4">
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Engine oil" value={s.oil} />
        <Field label="Coolant" value={s.coolant} />
        <Field label="Transmission" value={s.transmission} />
        <Field label="Brake" value={s.brake} />
        <Field label="Power steering" value={s.power_steering} />
      </div>
      {s.notes ? <Notice tone="info">{s.notes}</Notice> : null}
      <Citations urls={data.citations} />
      <AiDisclaimer />
    </div>
  )
}

function GuideView({ data }: { data: GuideResponse }) {
  const g = data.guide
  return (
    <div className="space-y-4">
      {g.warning ? (
        <Notice tone="danger" title="Before you start">
          {g.warning}
        </Notice>
      ) : null}

      {g.hours > 0 ? (
        <p className="text-sm text-slate-600">
          Suggested time: {g.hours} h. Confirm against your own book time before
          it goes on an estimate.
        </p>
      ) : null}

      <Steps title="Procedure" items={g.steps} />

      {g.torque.length > 0 ? (
        <div>
          <p className="nwi-label">Torque specs</p>
          <ul className="space-y-1">
            {g.torque.map((t) => (
              <li key={`${t.part}-${t.spec}`} className="flex justify-between gap-4 text-sm">
                <span className="text-slate-700">{t.part}</span>
                <span className="font-mono text-slate-900">{t.spec}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-red-800">
            Torque values above are AI-generated. Confirm each one in the service
            manual before applying it.
          </p>
        </div>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <Bullets title="Tools" items={g.tools} />
        <Bullets
          title="Parts"
          items={g.parts.map((p) => (p.qty > 1 ? `${p.qty} × ${p.name}` : p.name))}
        />
      </div>

      <Citations urls={data.citations} />
      <AiDisclaimer />
    </div>
  )
}

'use client'

// Tab shell for the four QuickWrench HD panels. Each tab says up front whether
// it needs an AI key, because three of the four do not and a tech should never
// be left guessing which half of a tool is currently useful.

import { useState } from 'react'
import DiagnosePanel from './diagnose-panel'
import FaultPanel from './fault-panel'
import GaugePanel from './gauge-panel'
import PartsPanel from './parts-panel'
import type { EngineStatus, JobOption } from './types'

type Tab = 'diagnose' | 'fault' | 'gauge' | 'parts'

const TABS: Array<{ id: Tab; label: string; needsAi: boolean }> = [
  { id: 'diagnose', label: 'Symptom & diagnosis', needsAi: true },
  { id: 'fault',    label: 'Fault code (SPN/FMI)', needsAi: false },
  { id: 'gauge',    label: 'Gauge readings',       needsAi: false },
  { id: 'parts',    label: 'Parts lookup',         needsAi: false },
]

export default function ToolShell({
  jobs,
  engine,
}: {
  jobs: JobOption[]
  engine: EngineStatus
}) {
  const [tab, setTab] = useState<Tab>(engine.primary === null ? 'fault' : 'diagnose')

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-2" aria-label="QuickWrench HD tools">
        {TABS.map((entry) => {
          const active = tab === entry.id
          const unavailable = entry.needsAi && engine.primary === null
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-current={active ? 'page' : undefined}
              className={active ? 'nwi-btn nwi-btn-primary' : 'nwi-btn nwi-btn-secondary'}
            >
              {entry.label}
              <span
                className={
                  unavailable
                    ? 'rounded bg-amber-100 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-amber-900'
                    : entry.needsAi
                      ? 'rounded bg-slate-100 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-600'
                      : 'rounded bg-emerald-100 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-800'
                }
              >
                {unavailable ? 'needs AI key' : entry.needsAi ? 'AI' : 'no AI needed'}
              </span>
            </button>
          )
        })}
      </nav>

      {tab === 'diagnose' ? <DiagnosePanel jobs={jobs} engine={engine} /> : null}
      {tab === 'fault'    ? <FaultPanel /> : null}
      {tab === 'gauge'    ? <GaugePanel jobs={jobs} /> : null}
      {tab === 'parts'    ? <PartsPanel /> : null}
    </div>
  )
}

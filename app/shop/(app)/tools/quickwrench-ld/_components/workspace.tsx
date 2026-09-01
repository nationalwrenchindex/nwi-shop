'use client'

// The QuickWrench LD workspace. Holds the one piece of state every panel shares
// — the vehicle — plus the current diagnostic, and wires the panels together.
//
// Nothing here fetches on mount. A tech opens this page mid-job; a lookup runs
// when they ask for it, against a vehicle they have confirmed.

import { useState } from 'react'
import type { LdDiagnoseResponse, LdDiagnostic } from '@/lib/shop/quickwrench/ld'
import AttachToJob from './attach-to-job'
import DiagnosePanel from './diagnose-panel'
import DiagnosticResult from './diagnostic-result'
import LookupsPanel from './lookups-panel'
import VehiclePanel from './vehicle-panel'
import { EMPTY_VEHICLE, type JobOption, type WorkVehicle } from './types'
import { Notice, Panel } from './ui'

export default function Workspace({
  jobs,
  aiEnabled,
}: {
  jobs:      JobOption[]
  aiEnabled: boolean
}) {
  const [vehicle, setVehicle] = useState<WorkVehicle>(EMPTY_VEHICLE)
  const [diagnostic, setDiagnostic] = useState<LdDiagnostic | null>(null)
  const [fromCache, setFromCache] = useState(false)

  function handleResult(payload: LdDiagnoseResponse) {
    setDiagnostic(payload.result)
    setFromCache(payload.cached)
  }

  return (
    <div className="space-y-6">
      {!aiEnabled ? (
        <Notice tone="warning" title="Diagnostics are not configured">
          GEMINI_API_KEY is not set on this deployment, so code lookup, symptom
          diagnosis and the AI spec lookups are unavailable. VIN decode, NHTSA
          recalls and NHTSA complaints do not use it and work normally.
        </Notice>
      ) : null}

      <VehiclePanel vehicle={vehicle} onChange={setVehicle} jobs={jobs} />

      <div className="grid gap-6 xl:grid-cols-2">
        <DiagnosePanel vehicle={vehicle} aiEnabled={aiEnabled} onResult={handleResult} />
        <LookupsPanel vehicle={vehicle} aiEnabled={aiEnabled} />
      </div>

      {diagnostic ? (
        <Panel title="Result">
          <DiagnosticResult result={diagnostic} cached={fromCache} />
        </Panel>
      ) : null}

      <AttachToJob jobs={jobs} result={diagnostic} vehicle={vehicle} />
    </div>
  )
}

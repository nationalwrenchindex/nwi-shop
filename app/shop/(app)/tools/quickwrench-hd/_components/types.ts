// Client-side shapes for the QuickWrench HD panels. Declared here rather than
// imported from lib/shop/quickwrench/hd.ts so the browser bundle never pulls in
// the server engine (and, with it, the entire prompt corpus and the Anthropic
// SDK). These mirror what the routes actually return.

export interface JobOption {
  id:         string
  jobNumber:  number
  label:      string
}

export interface DiagnosticSection {
  heading: string
  body:    string
}

export type EngineName = 'gemini' | 'anthropic'

export interface EngineStatus {
  gemini:    boolean
  anthropic: boolean
  primary:   EngineName | null
  model:     string | null
  grounded:  boolean
}

export interface HdPartView {
  part_number:    string
  manufacturer:   string
  description:    string
  category:       string
  subcategory:    string | null
  engine:         string | null
  unit_models:    string[] | null
  notes:          string | null
  superseded_by:  string | null
  field_critical: boolean
}

export interface HdCrossRefView {
  part_number: string
  cross_mfr:   string
  cross_part:  string
  cross_notes: string | null
}

export interface DiagnoseResponse {
  analysis:   string
  sections:   DiagnosticSection[]
  citations:  string[]
  source:     'cache' | 'gemini' | 'anthropic' | 'unavailable'
  model:      string | null
  hazard:     boolean
  disclaimer: string
  usable:     boolean
  heading:    string
  parts:      HdPartView[]
  engine:     EngineStatus
  notice:     string
  note:       string
}

export interface FaultResponse {
  spn:        { spn: number; meaning: string } | null
  fmi:        { fmi: number; meaning: string; fieldAdvice: string } | null
  fieldRule:  string | null
  unknown:    string[]
  label:      string
  disclaimer: string
  engine:     EngineStatus
}

export interface GaugeResponse {
  suctionStatus:   string
  dischargeStatus: string
  isEqualizing:    boolean
  dangerAlert:     boolean
  unmatched:       boolean
  readings:        { actualSuction: number; actualDischarge: number }
  severity:        { label: string; color: string; bg: string; border: string } | null
  pattern: {
    id:                string
    patternLabel:      string
    severity:          string
    causes:            string[]
    fieldVerification: string[]
    recommendedAction: string[]
    refrigerantNote?:  string
    laborEstimate:     string
    recoveryRequired:  boolean
  } | null
}

export interface VehicleDecode {
  vin:    string
  year:   string
  make:   string
  model:  string
  engine: string | null
  gvwr:   string | null
}

/** Every panel reports failure the same way: a string the tech can act on. */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${res.status}).`
    throw new Error(message)
  }
  return data as T
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${res.status}).`
    throw new Error(message)
  }
  return data as T
}

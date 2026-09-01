// QuickWrench LD — NHTSA lookups. No API key, no Gemini: these keep working on
// a deployment where GEMINI_API_KEY is absent, which is the whole point of
// keeping them in their own module.
//
// Ported from NWI Suite: src/app/api/quickwrench/vin/[vin], /recalls and /tsb.
//
// NAMING: NWI Suite calls the complaints lookup `tsb`, but the route calls
// NHTSA's *complaintsByVehicle* endpoint — those are owner complaints, not
// manufacturer Technical Service Bulletins. Repeating that misnomer here would
// put a tech on the wrong document, so it is named `complaints` throughout.
//
// EVERY external call degrades. A timeout or an NHTSA outage returns an empty
// result plus a message the UI can show; nothing in this file throws.

import type { LdVehicle } from './ld'
import { VIN_RE } from './ld'

/** How long we wait on NHTSA before giving up and returning a message. */
const NHTSA_TIMEOUT_MS = 12_000

/** NHTSA data is stable; an hour of caching keeps a busy board responsive. */
const NHTSA_REVALIDATE_S = 3600

export interface LookupOk<T> {
  ok:      true
  data:    T
  /** Non-fatal note, e.g. "no records for this vehicle". */
  message: string | null
}

export interface LookupFailed {
  ok:      false
  message: string
}

export type LookupResult<T> = LookupOk<T> | LookupFailed

function failureMessage(label: string, err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return `${label} timed out. NHTSA did not answer in ${NHTSA_TIMEOUT_MS / 1000}s — try again.`
  }
  if (err instanceof Error && err.name === 'TimeoutError') {
    return `${label} timed out. NHTSA did not answer in ${NHTSA_TIMEOUT_MS / 1000}s — try again.`
  }
  return `${label} is unavailable right now: ${err instanceof Error ? err.message : String(err)}`
}

/**
 * One fetch with a hard timeout, returning the parsed body and the status.
 * Never throws for a non-2xx — callers decide what an error status means,
 * because NHTSA answers "no complaints for this vehicle" with a 404.
 */
async function getJson(
  url: string,
  init?: { noStore?: boolean },
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(NHTSA_TIMEOUT_MS),
    ...(init?.noStore
      ? { cache: 'no-store' as const }
      : { next: { revalidate: NHTSA_REVALIDATE_S } }),
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    // Non-JSON response — leave body null and let the caller treat it as empty.
  }
  return { status: res.status, ok: res.ok, body }
}

// ---------------------------------------------------------------------------
// VIN decode — vPIC
// ---------------------------------------------------------------------------

interface VpicItem {
  Variable?: string
  Value?:    string | null
}

function vpicField(results: VpicItem[], name: string): string {
  return results.find((r) => r.Variable === name)?.Value?.trim() ?? ''
}

/** vPIC error codes that mean the VIN itself is unusable, not merely partial. */
const FATAL_VPIC_CODES = ['6', '7', '8', '9', '10', '11']

export async function decodeVin(rawVin: string): Promise<LookupResult<LdVehicle>> {
  const vin = rawVin.trim().toUpperCase()
  if (!VIN_RE.test(vin)) {
    return { ok: false, message: 'Invalid VIN — must be 17 characters (A–Z, 0–9, no I/O/Q).' }
  }

  let body: unknown
  try {
    const res = await getJson(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinextended/${vin}?format=json`,
    )
    if (!res.ok) return { ok: false, message: `VIN decode service returned ${res.status}.` }
    body = res.body
  } catch (err) {
    return { ok: false, message: failureMessage('VIN decode', err) }
  }

  const results: VpicItem[] = Array.isArray((body as { Results?: unknown })?.Results)
    ? ((body as { Results: VpicItem[] }).Results)
    : []

  if (results.length === 0) {
    return { ok: false, message: 'VIN decode returned nothing. Verify the VIN and try again.' }
  }

  const errorCode = vpicField(results, 'Error Code')
  const make  = vpicField(results, 'Make')
  const model = vpicField(results, 'Model')
  const year  = vpicField(results, 'Model Year')

  const codes = errorCode.split(',').map((c) => c.trim())
  const fatal = FATAL_VPIC_CODES.some((c) => codes.includes(c))

  if (fatal || (!make && !model)) {
    return {
      ok: false,
      message: `VIN could not be decoded. ${
        vpicField(results, 'Error Text') || 'Verify the VIN and try again.'
      }`,
    }
  }

  // Engine description assembled from whichever fields vPIC actually returned.
  const cylinders    = vpicField(results, 'Engine Number of Cylinders')
  const displacement = vpicField(results, 'Displacement (L)')
  const fuelType     = vpicField(results, 'Fuel Type - Primary')
  const engineModel  = vpicField(results, 'Engine Model')

  // vPIC returns displacement as a string that is usually but not always a
  // clean number ("5.3", "5.3000000000"). Format it when it parses, pass it
  // through untouched when it does not — never print "NaNL" at a tech.
  const displacementL = Number(displacement)
  let engine = ''
  if (displacement) {
    engine += Number.isFinite(displacementL)
      ? `${displacementL.toFixed(1)}L `
      : `${displacement} `
  }
  if (cylinders)    engine += `${cylinders}-cyl `
  if (fuelType && fuelType !== 'Gasoline') engine += `${fuelType} `
  if (engineModel)  engine += engineModel
  engine = engine.trim()

  const vehicle: LdVehicle = {
    vin:               vin,
    year,
    make,
    model,
    engine:            engine || 'N/A',
    trim:              vpicField(results, 'Trim') || undefined,
    driveType:         vpicField(results, 'Drive Type') || undefined,
    transmissionStyle: vpicField(results, 'Transmission Style') || undefined,
    fuelType:          fuelType || undefined,
    bodyClass:         vpicField(results, 'Body Class') || undefined,
  }

  // A partial decode is still useful — say so rather than hiding it.
  const message = !year || !model
    ? 'Partial decode — vPIC did not return every field. Confirm year and model with the vehicle.'
    : null

  return { ok: true, data: vehicle, message }
}

// ---------------------------------------------------------------------------
// Recalls — api.nhtsa.gov/recalls/recallsByVehicle
// ---------------------------------------------------------------------------

/**
 * Raw NHTSA payload. Every field is optional — the API omits keys rather than
 * nulling them, which is why each read below has a fallback.
 */
interface NhtsaRecall {
  NHTSACampaignNumber?: string
  Component?:           string
  Summary?:             string
  Consequence?:         string
  Remedy?:              string
  ReportReceivedDate?:  string
}

export interface LdRecall {
  campaignNumber: string
  component:      string
  summary:        string
  consequence:    string
  remedy:         string
  reportDate:     string
}

/** NHTSA sometimes serves `/Date(1234567890)/` instead of an ISO string. */
function formatNhtsaDate(raw: string | undefined): string {
  if (!raw) return ''
  const dotnet = raw.match(/\/Date\((\d+)\)\//)
  const parsed = dotnet ? new Date(Number(dotnet[1])) : new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export interface VehicleQuery {
  make:  string
  model: string
  year:  string
}

export async function fetchRecalls(q: VehicleQuery): Promise<LookupResult<LdRecall[]>> {
  const url =
    'https://api.nhtsa.gov/recalls/recallsByVehicle' +
    `?make=${encodeURIComponent(q.make)}` +
    `&model=${encodeURIComponent(q.model)}` +
    `&modelYear=${encodeURIComponent(q.year)}`

  try {
    const res = await getJson(url)
    if (!res.ok) {
      return { ok: true, data: [], message: `NHTSA returned ${res.status} — no recall data available.` }
    }

    const raw: NhtsaRecall[] = Array.isArray((res.body as { results?: unknown })?.results)
      ? (res.body as { results: NhtsaRecall[] }).results
      : []

    const recalls: LdRecall[] = raw.map((r) => ({
      campaignNumber: r.NHTSACampaignNumber ?? '',
      component:      r.Component ?? '',
      summary:        r.Summary ?? '',
      consequence:    r.Consequence ?? '',
      remedy:         r.Remedy ?? '',
      reportDate:     formatNhtsaDate(r.ReportReceivedDate),
    }))

    return {
      ok: true,
      data: recalls,
      message: recalls.length === 0
        ? 'No recall campaigns on file for this year, make and model.'
        : null,
    }
  } catch (err) {
    return { ok: false, message: failureMessage('Recall lookup', err) }
  }
}

// ---------------------------------------------------------------------------
// Complaints — api.nhtsa.gov/complaints/complaintsByVehicle
//
// This is the endpoint NWI Suite mislabels as `tsb`. It returns NHTSA owner
// complaints. It is NOT a source of manufacturer TSBs and must never be
// presented as one.
// ---------------------------------------------------------------------------

interface NhtsaComplaint {
  components?:     string
  component?:      string
  dateOfIncident?: string
  incidentDate?:   string
  summary?:        string
  description?:    string
  crash?:          boolean
  fire?:           boolean
}

/** Keys arrive in both camelCase and PascalCase depending on the endpoint. */
interface NhtsaComplaintsResponse {
  count?:   number
  Count?:   number
  message?: string
  Message?: string
  results?: NhtsaComplaint[]
  Results?: NhtsaComplaint[]
}

export interface LdComplaintDetail {
  dateOfIncident: string
  summary:        string
  crash:          boolean
  fire:           boolean
}

export interface LdComplaintGroup {
  component:  string
  count:      number
  complaints: LdComplaintDetail[]
}

export interface LdComplaints {
  groups: LdComplaintGroup[]
  total:  number
}

function isEmptyComplaintPayload(parsed: NhtsaComplaintsResponse | null): boolean {
  if (!parsed) return false
  if (parsed.count === 0 || parsed.Count === 0) return true
  const msg = parsed.message ?? parsed.Message
  if (typeof msg === 'string' && msg.toLowerCase().includes('results returned')) return true
  if (!parsed.results && !parsed.Results) return true
  return (parsed.results ?? parsed.Results ?? []).length === 0
}

/** Max component groups returned — the full list is unreadable on a tablet. */
const MAX_COMPLAINT_GROUPS = 15

export async function fetchComplaints(q: VehicleQuery): Promise<LookupResult<LdComplaints>> {
  const makeUpper     = q.make.toUpperCase()
  const modelUpper    = q.model.toUpperCase()
  const modelNoSpaces = modelUpper.replace(/\s+/g, '')

  const attempt = async (modelVariant: string) => {
    const url =
      'https://api.nhtsa.gov/complaints/complaintsByVehicle' +
      `?make=${encodeURIComponent(makeUpper)}` +
      `&model=${encodeURIComponent(modelVariant)}` +
      `&modelYear=${encodeURIComponent(q.year)}`
    // no-store: this endpoint answers 400/404 for "no results", and caching a
    // negative answer keyed on a model spelling we are about to retry is wrong.
    const res = await getJson(url, { noStore: true })
    return { ...res, parsed: (res.body as NhtsaComplaintsResponse | null) ?? null }
  }

  try {
    let result = await attempt(modelUpper)

    // NHTSA rejects some spellings; "F 150" vs "F150" is the usual culprit.
    if ((result.status === 400 || result.status === 404) && modelNoSpaces !== modelUpper) {
      result = await attempt(modelNoSpaces)
    }

    if (isEmptyComplaintPayload(result.parsed)) {
      return {
        ok: true,
        data: { groups: [], total: 0 },
        message: 'No owner complaints on file for this year, make and model.',
      }
    }

    if (!result.ok) {
      return {
        ok: true,
        data: { groups: [], total: 0 },
        message: `NHTSA returned ${result.status} — complaint data unavailable.`,
      }
    }

    const raw: NhtsaComplaint[] = result.parsed?.results ?? result.parsed?.Results ?? []
    const map = new Map<string, { count: number; complaints: LdComplaintDetail[] }>()

    for (const r of raw) {
      const component = (r.components ?? r.component ?? 'Unknown Component').toString().trim()
      const entry = map.get(component) ?? { count: 0, complaints: [] }
      entry.count++
      entry.complaints.push({
        dateOfIncident: r.dateOfIncident ?? r.incidentDate ?? '',
        summary:        r.summary ?? r.description ?? '',
        crash:          !!r.crash,
        fire:           !!r.fire,
      })
      map.set(component, entry)
    }

    const groups: LdComplaintGroup[] = Array.from(map.entries())
      .map(([component, d]) => ({ component, ...d }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_COMPLAINT_GROUPS)

    return { ok: true, data: { groups, total: raw.length }, message: null }
  } catch (err) {
    return { ok: false, message: failureMessage('Complaint lookup', err) }
  }
}

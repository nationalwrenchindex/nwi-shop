// Job-board domain logic. This module is the single source of truth for the job
// status flow, for what a line item looks like once cost fields have been
// stripped for a role that may not see them, and for the queries that feed the
// board. Both the API routes and the UI import from here so they cannot
// disagree about what "advance" means.
//
// This file is intentionally free of server-only imports (`next/headers`,
// `@/lib/supabase/server`) so client components can import the pure helpers.
// Query helpers therefore take an already-constructed Supabase client.

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  JobStatus,
  LineItemType,
  ShopBay,
  ShopCustomer,
  ShopJob,
  ShopJobLineItem,
  ShopTech,
  ShopVehicle,
} from '@/lib/types'

// ---------------------------------------------------------------------------
// Status flow
// ---------------------------------------------------------------------------

/** estimate -> approved -> in_progress -> completed -> invoiced */
export const JOB_STATUS_ORDER: readonly JobStatus[] = [
  'estimate',
  'approved',
  'in_progress',
  'completed',
  'invoiced',
] as const

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  estimate:    'Estimate',
  approved:    'Approved',
  in_progress: 'In progress',
  completed:   'Completed',
  invoiced:    'Invoiced',
}

/** Tailwind classes for the status pill. High contrast on a bright tablet. */
export const JOB_STATUS_PILL: Record<JobStatus, string> = {
  estimate:    'bg-slate-200 text-slate-800 ring-slate-300',
  approved:    'bg-sky-100 text-sky-900 ring-sky-300',
  in_progress: 'bg-amber-200 text-amber-950 ring-amber-500',
  completed:   'bg-emerald-100 text-emerald-900 ring-emerald-400',
  invoiced:    'bg-violet-100 text-violet-900 ring-violet-300',
}

/** The verb on the advance button for the transition out of `status`. */
export const JOB_ADVANCE_LABELS: Record<JobStatus, string | null> = {
  estimate:    'Approve',
  approved:    'Start work',
  in_progress: 'Mark complete',
  completed:   'Mark invoiced',
  invoiced:    null,
}

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && (JOB_STATUS_ORDER as readonly string[]).includes(value)
}

/** The one status a job may move to, or null when it is at the end of the flow. */
export function nextStatus(status: JobStatus): JobStatus | null {
  const i = JOB_STATUS_ORDER.indexOf(status)
  if (i < 0 || i === JOB_STATUS_ORDER.length - 1) return null
  return JOB_STATUS_ORDER[i + 1]
}

/** The subset of a job the transition rules actually read. */
export interface AdvanceSubject {
  status:           JobStatus
  bay_id:           string | null
  assigned_tech_id: string | null
  voided:           boolean
}

export interface AdvanceCheck {
  /** True when the advance button should be enabled and the API should accept. */
  ok:     boolean
  next:   JobStatus | null
  label:  string | null
  /** Human-readable blocker, present whenever `ok` is false. */
  reason: string | null
}

/**
 * The gate for every status change. The API route and the UI button both call
 * this, so a disabled button and a rejected request always share one reason.
 */
export function canAdvance(job: AdvanceSubject): AdvanceCheck {
  const next = nextStatus(job.status)
  const label = JOB_ADVANCE_LABELS[job.status]

  if (job.voided) {
    return { ok: false, next: null, label: null, reason: 'This job has been voided.' }
  }
  if (!next) {
    return { ok: false, next: null, label: null, reason: 'This job is already invoiced.' }
  }
  if (next === 'in_progress' && !job.bay_id) {
    return { ok: false, next, label, reason: 'Assign a bay before starting work.' }
  }
  if (next === 'in_progress' && !job.assigned_tech_id) {
    return { ok: false, next, label, reason: 'Assign a tech before starting work.' }
  }
  return { ok: true, next, label, reason: null }
}

/**
 * Field changes applied to the job row itself for a transition. Bay-side side
 * effects (flipping shop_bays.status / current_job_id) are separate because they
 * touch a different table - see `bayEffectForStatus`.
 */
export function jobPatchForStatus(
  next: JobStatus,
  now: string,
): Partial<Pick<ShopJob, 'status' | 'bay_assigned_at' | 'completed_at' | 'invoiced_at'>> {
  switch (next) {
    case 'in_progress':
      return { status: next, bay_assigned_at: now }
    case 'completed':
      return { status: next, completed_at: now }
    case 'invoiced':
      return { status: next, invoiced_at: now }
    default:
      return { status: next }
  }
}

/** What should happen to the job's bay when the job reaches `next`. */
export function bayEffectForStatus(next: JobStatus): 'occupy' | 'free' | 'none' {
  if (next === 'in_progress') return 'occupy'
  if (next === 'completed') return 'free'
  return 'none'
}

// ---------------------------------------------------------------------------
// Money + margin. Cost fields are absent (not null) on the view type so a role
// without `viewMargins` never receives the key at all.
// ---------------------------------------------------------------------------

export function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

export function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/**
 * `tax_rate` is stored as a plain number and shops enter it either as 7 or as
 * 0.07. Anything above 1 is read as a percentage.
 */
export function taxAmount(subtotal: number, taxRate: number): number {
  const rate = taxRate > 1 ? taxRate / 100 : taxRate
  return round2(subtotal * (Number.isFinite(rate) ? rate : 0))
}

export interface JobLineItemView {
  id:           string
  job_id:       string
  type:         LineItemType
  description:  string
  part_number:  string | null
  quantity:     number
  tech_id:      string | null
  unit_price:   number
  total:        number
  inventory_id: string | null
  created_at:   string
  // Present only when the caller has `permissions.viewMargins`.
  unit_cost?:     number
  extended_cost?: number
  margin?:        number
  margin_pct?:    number
}

/**
 * Server-side redaction. Call this before a line item crosses to the client or
 * into a JSON response - a foreman sees quantity and sell price but never cost
 * or margin.
 */
export function toLineItemView(row: ShopJobLineItem, viewMargins: boolean): JobLineItemView {
  const base: JobLineItemView = {
    id:           row.id,
    job_id:       row.job_id,
    type:         row.type,
    description:  row.description,
    part_number:  row.part_number,
    quantity:     Number(row.quantity) || 0,
    tech_id:      row.tech_id,
    unit_price:   Number(row.unit_price) || 0,
    total:        Number(row.total) || 0,
    inventory_id: row.inventory_id,
    created_at:   row.created_at,
  }
  if (!viewMargins) return base

  const unitCost = Number(row.unit_cost) || 0
  const extended = round2(unitCost * base.quantity)
  const margin = round2(base.total - extended)
  return {
    ...base,
    unit_cost:     unitCost,
    extended_cost: extended,
    margin,
    margin_pct:    base.total > 0 ? round2((margin / base.total) * 100) : 0,
  }
}

export interface JobTotals {
  laborHours:  number
  laborTotal:  number
  partsTotal:  number
  subtotal:    number
  tax:         number
  total:       number
  /** Present only when the caller has `permissions.viewMargins`. */
  costTotal?:  number
  margin?:     number
  marginPct?:  number
}

/**
 * `withMargins` must be the caller's `permissions.viewMargins`. When it is
 * false the returned object has no cost keys at all.
 */
export function summarizeLineItems(
  items: JobLineItemView[],
  taxRate: number,
  withMargins: boolean,
): JobTotals {
  let laborHours = 0
  let laborTotal = 0
  let partsTotal = 0
  let costTotal = 0

  for (const item of items) {
    if (item.type === 'labor') {
      laborHours += item.quantity
      laborTotal += item.total
    } else {
      partsTotal += item.total
    }
    costTotal += item.extended_cost ?? 0
  }

  const subtotal = round2(laborTotal + partsTotal)
  // Tax applies to PARTS ONLY — labor is untaxed in most states. This must stay
  // in step with lib/shop/invoice.ts and lib/shop/quickbooks.ts: they are three
  // views of the same money, and a job board card that disagrees with the
  // invoice the customer receives is a support call.
  const tax = taxAmount(partsTotal, taxRate)
  const totals: JobTotals = {
    laborHours: round2(laborHours),
    laborTotal: round2(laborTotal),
    partsTotal: round2(partsTotal),
    subtotal,
    tax,
    total: round2(subtotal + tax),
  }
  if (!withMargins) return totals

  const margin = round2(subtotal - costTotal)
  return {
    ...totals,
    costTotal: round2(costTotal),
    margin,
    marginPct: subtotal > 0 ? round2((margin / subtotal) * 100) : 0,
  }
}

// ---------------------------------------------------------------------------
// Request body coercion. The job-board API routes all take small JSON bodies;
// these keep the routes free of `any` and of repeated typeof checks.
// ---------------------------------------------------------------------------

export type JsonBody = Record<string, unknown>

/** Parses a JSON request body, returning null on malformed or non-object input. */
export async function readJsonBody(req: Request): Promise<JsonBody | null> {
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as JsonBody
  } catch {
    return null
  }
}

/** Trimmed string, or null for missing/blank values. */
export function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

/** Finite number from a number or numeric string, else null. */
export function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

/** JSON error response with the shape every route in this area returns. */
export function apiError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

/**
 * PostgREST `or=` filters are parsed as a comma-separated expression list, so a
 * user-typed comma or paren would change the query. Strip them plus the LIKE
 * wildcards before interpolating a search term.
 */
export function sanitizeSearch(term: string): string {
  return term.replace(/[,()*%\\]/g, ' ').trim().slice(0, 64)
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function customerName(
  c: Pick<ShopCustomer, 'first_name' | 'last_name' | 'company'> | null,
): string {
  if (!c) return 'No customer'
  const person = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
  if (c.company && person) return `${c.company} - ${person}`
  return c.company || person || 'No customer'
}

export function vehicleLabel(
  v: Pick<ShopVehicle, 'year' | 'make' | 'model' | 'unit_number'> | null,
): string {
  if (!v) return 'No vehicle'
  const parts = [v.year ? String(v.year) : null, v.make, v.model].filter(Boolean)
  const base = parts.join(' ').trim()
  if (v.unit_number) return base ? `${base} (#${v.unit_number})` : `Unit #${v.unit_number}`
  return base || 'No vehicle'
}

export function techName(t: Pick<ShopTech, 'first_name' | 'last_name'> | null): string | null {
  if (!t) return null
  return [t.first_name, t.last_name].filter(Boolean).join(' ').trim() || null
}

/** Formats a millisecond span as "3h 24m", or "12m 05s" under an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

// ---------------------------------------------------------------------------
// Client-facing view models. Pay rate never leaves the server on these.
// ---------------------------------------------------------------------------

export interface TechOption {
  id:         string
  first_name: string
  last_name:  string
  active:     boolean
}

export function toTechOption(t: ShopTech): TechOption {
  return { id: t.id, first_name: t.first_name, last_name: t.last_name, active: t.active }
}

export interface JobCard {
  id:               string
  job_number:       number
  status:           JobStatus
  complaint:        string | null
  description:      string | null
  estimated_hours:  number | null
  bay_id:           string | null
  assigned_tech_id: string | null
  bay_assigned_at:  string | null
  created_at:       string
  voided:           boolean
  customer_name:    string
  vehicle_label:    string
  tech_name:        string | null
}

export function toJobCard(
  job: ShopJob,
  customer: ShopCustomer | null,
  vehicle: ShopVehicle | null,
  tech: ShopTech | null,
): JobCard {
  return {
    id:               job.id,
    job_number:       job.job_number,
    status:           job.status,
    complaint:        job.complaint,
    description:      job.description,
    estimated_hours:  job.estimated_hours === null ? null : Number(job.estimated_hours),
    bay_id:           job.bay_id,
    assigned_tech_id: job.assigned_tech_id,
    bay_assigned_at:  job.bay_assigned_at,
    created_at:       job.created_at,
    voided:           job.voided,
    customer_name:    customerName(customer),
    vehicle_label:    vehicleLabel(vehicle),
    tech_name:        techName(tech),
  }
}

// ---------------------------------------------------------------------------
// Queries. Every helper is shop-scoped and returns empty data rather than
// throwing, so the board renders a degraded state instead of a 500 while the
// migrations are still being applied.
// ---------------------------------------------------------------------------

/** A non-null `techId` scopes the caller to jobs assigned to that tech. */
export interface JobScope {
  shopId: string
  techId: string | null
}

async function safeList<T>(run: () => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const { data } = await run()
    return data ?? []
  } catch {
    return []
  }
}

function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]))
}

export interface JobBoardData {
  bays:  ShopBay[]
  jobs:  JobCard[]
  techs: TechOption[]
  /** True when at least one query failed - the UI shows a warning banner. */
  degraded: boolean
}

export async function loadJobBoard(
  supabase: SupabaseClient,
  scope: JobScope,
): Promise<JobBoardData> {
  const jobsQuery = supabase
    .from('shop_jobs')
    .select('*')
    .eq('shop_id', scope.shopId)
    .eq('voided', false)
    .order('created_at', { ascending: false })
    .limit(300)

  const scopedJobs = scope.techId ? jobsQuery.eq('assigned_tech_id', scope.techId) : jobsQuery

  const [jobRows, bays, techRows] = await Promise.all([
    safeList<ShopJob>(() => scopedJobs.returns<ShopJob[]>()),
    safeList<ShopBay>(() =>
      supabase
        .from('shop_bays')
        .select('*')
        .eq('shop_id', scope.shopId)
        .order('sort_order', { ascending: true })
        .returns<ShopBay[]>(),
    ),
    safeList<ShopTech>(() =>
      supabase
        .from('shop_techs')
        .select('*')
        .eq('shop_id', scope.shopId)
        .order('first_name', { ascending: true })
        .returns<ShopTech[]>(),
    ),
  ])

  const customerIds = [...new Set(jobRows.map((j) => j.customer_id).filter((v): v is string => !!v))]
  const vehicleIds = [...new Set(jobRows.map((j) => j.vehicle_id).filter((v): v is string => !!v))]

  const [customers, vehicles] = await Promise.all([
    customerIds.length
      ? safeList<ShopCustomer>(() =>
          supabase
            .from('shop_customers')
            .select('*')
            .eq('shop_id', scope.shopId)
            .in('id', customerIds)
            .returns<ShopCustomer[]>(),
        )
      : Promise.resolve<ShopCustomer[]>([]),
    vehicleIds.length
      ? safeList<ShopVehicle>(() =>
          supabase
            .from('shop_vehicles')
            .select('*')
            .eq('shop_id', scope.shopId)
            .in('id', vehicleIds)
            .returns<ShopVehicle[]>(),
        )
      : Promise.resolve<ShopVehicle[]>([]),
  ])

  const customerMap = byId(customers)
  const vehicleMap = byId(vehicles)
  const techMap = byId(techRows)

  const jobs = jobRows.map((job) =>
    toJobCard(
      job,
      job.customer_id ? customerMap.get(job.customer_id) ?? null : null,
      job.vehicle_id ? vehicleMap.get(job.vehicle_id) ?? null : null,
      job.assigned_tech_id ? techMap.get(job.assigned_tech_id) ?? null : null,
    ),
  )

  // A shop with no bays and no jobs is either brand new or the migrations have
  // not been applied. Either way the board renders its empty state.
  const degraded = bays.length === 0 && jobRows.length === 0 && techRows.length === 0

  return {
    bays,
    jobs,
    techs: techRows.filter((t) => t.active).map(toTechOption),
    degraded,
  }
}

/** Jobs waiting for a bay: unassigned, not finished, newest first. */
export function unassignedJobs(jobs: JobCard[]): JobCard[] {
  return jobs.filter(
    (job) => !job.bay_id && job.status !== 'completed' && job.status !== 'invoiced' && !job.voided,
  )
}

export interface JobDetail {
  job:       ShopJob
  customer:  ShopCustomer | null
  vehicle:   ShopVehicle | null
  bay:       ShopBay | null
  tech:      ShopTech | null
  lineItems: ShopJobLineItem[]
}

/**
 * Loads one job with everything the detail panel needs. Returns null when the
 * job does not exist, belongs to another shop, or - when `scope.techId` is set -
 * is not assigned to that tech. Role scoping lives in the query, not the UI.
 */
export async function loadJobDetail(
  supabase: SupabaseClient,
  jobId: string,
  scope: JobScope,
): Promise<JobDetail | null> {
  const rows = await safeList<ShopJob>(() => {
    const query = supabase
      .from('shop_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('shop_id', scope.shopId)
      .limit(1)
    return (scope.techId ? query.eq('assigned_tech_id', scope.techId) : query).returns<ShopJob[]>()
  })

  const job = rows[0]
  if (!job) return null

  const customerId = job.customer_id
  const vehicleId = job.vehicle_id
  const bayId = job.bay_id
  const assignedTechId = job.assigned_tech_id

  const [customers, vehicles, bays, techs, lineItems] = await Promise.all([
    customerId
      ? safeList<ShopCustomer>(() =>
          supabase
            .from('shop_customers')
            .select('*')
            .eq('id', customerId)
            .eq('shop_id', scope.shopId)
            .returns<ShopCustomer[]>(),
        )
      : Promise.resolve<ShopCustomer[]>([]),
    vehicleId
      ? safeList<ShopVehicle>(() =>
          supabase
            .from('shop_vehicles')
            .select('*')
            .eq('id', vehicleId)
            .eq('shop_id', scope.shopId)
            .returns<ShopVehicle[]>(),
        )
      : Promise.resolve<ShopVehicle[]>([]),
    bayId
      ? safeList<ShopBay>(() =>
          supabase
            .from('shop_bays')
            .select('*')
            .eq('id', bayId)
            .eq('shop_id', scope.shopId)
            .returns<ShopBay[]>(),
        )
      : Promise.resolve<ShopBay[]>([]),
    assignedTechId
      ? safeList<ShopTech>(() =>
          supabase
            .from('shop_techs')
            .select('*')
            .eq('id', assignedTechId)
            .eq('shop_id', scope.shopId)
            .returns<ShopTech[]>(),
        )
      : Promise.resolve<ShopTech[]>([]),
    safeList<ShopJobLineItem>(() =>
      supabase
        .from('shop_job_line_items')
        .select('*')
        .eq('job_id', jobId)
        .eq('shop_id', scope.shopId)
        .order('created_at', { ascending: true })
        .returns<ShopJobLineItem[]>(),
    ),
  ])

  return {
    job,
    customer:  customers[0] ?? null,
    vehicle:   vehicles[0] ?? null,
    bay:       bays[0] ?? null,
    tech:      techs[0] ?? null,
    lineItems,
  }
}

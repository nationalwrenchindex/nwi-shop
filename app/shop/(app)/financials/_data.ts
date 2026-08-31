// Server-only data layer for /shop/financials and its two API routes.
//
// One query path, three callers (the page, /api/shop/financials/summary and
// /api/shop/financials/export) so the numbers on screen can never disagree with
// the numbers in the exported file.
//
// An invoice is a shop_jobs row at status 'invoiced' with voided = false. Both
// filters are applied IN THE QUERY, not in the UI, so a voided job cannot leak into
// a total or an export by way of a rendering bug.

import { createClient } from '@/lib/supabase/server'
import { nextDay, type ExportInvoice, type ExportLineItem } from '@/lib/shop/quickbooks'
import type { LineItemType } from '@/lib/types'

interface JobRow {
  id:          string
  job_number:  number
  customer_id: string | null
  vehicle_id:  string | null
  description: string | null
  invoiced_at: string | null
  created_at:  string
}

interface LineItemRow {
  id:          string
  job_id:      string
  type:        LineItemType
  description: string | null
  part_number: string | null
  quantity:    number | null
  unit_cost:   number | null
  unit_price:  number | null
  total:       number | null
}

interface CustomerRow {
  id:         string
  first_name: string | null
  last_name:  string | null
  company:    string | null
}

interface VehicleRow {
  id:          string
  year:        number | null
  make:        string | null
  model:       string | null
  unit_number: string | null
}

export interface InvoiceFetch {
  invoices: ExportInvoice[]
  /** Non-null when the query failed. Callers degrade to an empty range instead of
   *  crashing - the migrations may not be applied in every environment yet. */
  error: string | null
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function customerName(c: CustomerRow | undefined): string | null {
  if (!c) return null
  const company = c.company?.trim()
  if (company) return company
  const person = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
  return person.length > 0 ? person : null
}

function vehicleLabel(v: VehicleRow | undefined): string | null {
  if (!v) return null
  const base = [v.year, v.make, v.model].filter(Boolean).join(' ').trim()
  const unit = v.unit_number?.trim()
  if (base && unit) return `${base} (Unit ${unit})`
  if (base) return base
  if (unit) return `Unit ${unit}`
  return null
}

/**
 * Every invoice in [from, to] (inclusive dates) for one shop, joined and flattened
 * into the ExportInvoice contract.
 *
 * The joins are separate queries stitched in JS rather than PostgREST embedded
 * resources: embedding depends on foreign-key names that vary with how the
 * migration was written, and a missing relationship fails the WHOLE query. Four
 * plain selects always work.
 *
 * The upper bound is an exclusive `< nextDay(to) 00:00Z`, not `lte to`, so an
 * invoice stamped at 4pm on the last day of the range is not silently dropped.
 */
export async function fetchInvoices(
  shopId: string,
  from: string,
  to: string,
): Promise<InvoiceFetch> {
  const supabase = await createClient()

  const { data: jobData, error: jobError } = await supabase
    .from('shop_jobs')
    .select('id, job_number, customer_id, vehicle_id, description, invoiced_at, created_at')
    .eq('shop_id', shopId)
    .eq('status', 'invoiced')
    .eq('voided', false)
    .gte('invoiced_at', `${from}T00:00:00.000Z`)
    .lt('invoiced_at', `${nextDay(to)}T00:00:00.000Z`)
    .order('invoiced_at', { ascending: true })

  if (jobError) return { invoices: [], error: jobError.message }

  const jobs = (jobData ?? []) as JobRow[]
  if (jobs.length === 0) return { invoices: [], error: null }

  const jobIds      = jobs.map(j => j.id)
  const customerIds = [...new Set(jobs.map(j => j.customer_id).filter((v): v is string => !!v))]
  const vehicleIds  = [...new Set(jobs.map(j => j.vehicle_id).filter((v): v is string => !!v))]

  const [lineItemRes, customerRes, vehicleRes] = await Promise.all([
    supabase
      .from('shop_job_line_items')
      .select('id, job_id, type, description, part_number, quantity, unit_cost, unit_price, total')
      .eq('shop_id', shopId)
      .in('job_id', jobIds),
    customerIds.length > 0
      ? supabase
          .from('shop_customers')
          .select('id, first_name, last_name, company')
          .eq('shop_id', shopId)
          .in('id', customerIds)
      : Promise.resolve({ data: [], error: null }),
    vehicleIds.length > 0
      ? supabase
          .from('shop_vehicles')
          .select('id, year, make, model, unit_number')
          .eq('shop_id', shopId)
          .in('id', vehicleIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  // A failed line-item query would silently produce $0 invoices, which is worse than
  // an error banner - so it is reported. Customer/vehicle failures only cost a label,
  // so those degrade to "Unknown Customer" and keep the money correct.
  if (lineItemRes.error) return { invoices: [], error: lineItemRes.error.message }

  const lineItems = (lineItemRes.data ?? []) as LineItemRow[]
  const customers = new Map(((customerRes.data ?? []) as CustomerRow[]).map(c => [c.id, c]))
  const vehicles  = new Map(((vehicleRes.data ?? []) as VehicleRow[]).map(v => [v.id, v]))

  const linesByJob = new Map<string, ExportLineItem[]>()
  for (const li of lineItems) {
    const list = linesByJob.get(li.job_id) ?? []
    list.push({
      id:          li.id,
      type:        li.type,
      description: li.description ?? '',
      part_number: li.part_number,
      quantity:    num(li.quantity),
      unit_cost:   num(li.unit_cost),
      unit_price:  num(li.unit_price),
      total:       num(li.total),
    })
    linesByJob.set(li.job_id, list)
  }

  const invoices: ExportInvoice[] = jobs.map(job => ({
    id:            job.id,
    job_number:    job.job_number,
    invoiced_at:   job.invoiced_at,
    created_at:    job.created_at,
    description:   job.description,
    customer_name: customerName(job.customer_id ? customers.get(job.customer_id) : undefined),
    vehicle_label: vehicleLabel(job.vehicle_id ? vehicles.get(job.vehicle_id) : undefined),
    line_items:    linesByJob.get(job.id) ?? [],
  }))

  return { invoices, error: null }
}

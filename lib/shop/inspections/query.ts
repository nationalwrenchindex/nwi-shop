// Reads against `shop_inspections`, shared by the pages and the API routes.
//
// Every function here returns a `warning` instead of throwing. Migration 009 has
// to be applied by hand in the Supabase SQL editor, so until somebody runs it
// these tables do not exist — and a compliance screen that renders an empty list
// plus an honest notice is far more useful than one that 500s.
//
// The client is passed in rather than constructed, matching lib/shop/jobs.ts, so
// this module stays free of server-only imports.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShopCustomer, ShopJob, ShopVehicle } from '@/lib/types'
import type { ReportContext } from './report'
import type { InspectionType, ShopInspection } from './types'

export interface InspectionListResult {
  inspections: ShopInspection[]
  /** Set when the read failed — usually "relation does not exist" before 009 is applied. */
  warning:     string | null
}

export interface InspectionFilters {
  types?:      InspectionType[]
  vehicleId?:  string
  jobId?:      string
  from?:       string
  to?:         string
  limit?:      number
}

export async function listInspections(
  supabase: SupabaseClient,
  shopId: string,
  filters: InspectionFilters = {},
): Promise<InspectionListResult> {
  let query = supabase
    .from('shop_inspections')
    .select('*')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 100)

  if (filters.types && filters.types.length > 0) query = query.in('type', filters.types)
  if (filters.vehicleId) query = query.eq('vehicle_id', filters.vehicleId)
  if (filters.jobId) query = query.eq('job_id', filters.jobId)
  if (filters.from) query = query.gte('created_at', filters.from)
  if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59.999Z`)

  const { data, error } = await query.returns<ShopInspection[]>()
  if (error) return { inspections: [], warning: error.message }
  return { inspections: data ?? [], warning: null }
}

export interface LoadedInspection {
  inspection: ShopInspection | null
  context:    ReportContext
  warning:    string | null
}

/**
 * One inspection plus the labels the report prints. The links are resolved with
 * plain id lookups rather than PostgREST embeds because all three are
 * ON DELETE SET NULL: the row is expected to outlive them, and a missing job or
 * a deleted vehicle must not stop the document rendering.
 */
export async function loadInspection(
  supabase: SupabaseClient,
  shopId: string,
  id: string,
  businessName = '',
): Promise<LoadedInspection> {
  const empty: ReportContext = {
    businessName,
    vehicleLabel:  null,
    customerLabel: null,
    jobNumber:     null,
  }

  const { data, error } = await supabase
    .from('shop_inspections')
    .select('*')
    .eq('id', id)
    .eq('shop_id', shopId)
    .maybeSingle<ShopInspection>()

  if (error) return { inspection: null, context: empty, warning: error.message }
  if (!data) return { inspection: null, context: empty, warning: null }

  const [vehicle, customer, job] = await Promise.all([
    data.vehicle_id
      ? supabase
          .from('shop_vehicles')
          .select('year, make, model, unit_number, vin')
          .eq('id', data.vehicle_id)
          .eq('shop_id', shopId)
          .maybeSingle<Pick<ShopVehicle, 'year' | 'make' | 'model' | 'unit_number' | 'vin'>>()
      : Promise.resolve({ data: null }),
    data.customer_id
      ? supabase
          .from('shop_customers')
          .select('first_name, last_name, company')
          .eq('id', data.customer_id)
          .eq('shop_id', shopId)
          .maybeSingle<Pick<ShopCustomer, 'first_name' | 'last_name' | 'company'>>()
      : Promise.resolve({ data: null }),
    data.job_id
      ? supabase
          .from('shop_jobs')
          .select('job_number')
          .eq('id', data.job_id)
          .eq('shop_id', shopId)
          .maybeSingle<Pick<ShopJob, 'job_number'>>()
      : Promise.resolve({ data: null }),
  ])

  return {
    inspection: data,
    context: {
      businessName,
      vehicleLabel:  vehicle.data ? vehicleLabel(vehicle.data) : null,
      customerLabel: customer.data ? customerLabel(customer.data) : null,
      jobNumber:     job.data?.job_number ?? null,
    },
    warning: null,
  }
}

export function vehicleLabel(
  vehicle: Pick<ShopVehicle, 'year' | 'make' | 'model' | 'unit_number' | 'vin'>,
): string {
  const description = [vehicle.year, vehicle.make, vehicle.model]
    .filter((part) => part !== null && part !== undefined && String(part).length > 0)
    .join(' ')
  const unit = vehicle.unit_number ? `Unit ${vehicle.unit_number}` : null
  return [unit, description || null].filter(Boolean).join(' — ')
    || vehicle.vin
    || 'Vehicle'
}

export function customerLabel(
  customer: Pick<ShopCustomer, 'first_name' | 'last_name' | 'company'>,
): string {
  const person = `${customer.first_name} ${customer.last_name}`.trim()
  if (customer.company) return person ? `${customer.company} (${person})` : customer.company
  return person || 'Customer'
}

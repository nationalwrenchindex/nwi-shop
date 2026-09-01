// What the new-inspection form needs to offer in its selectors, and the one read
// that fetches it.
//
// Both tools ask for the same four lists, so the query lives here instead of
// being written twice. Every list degrades to empty on error: an inspection with
// no work order and no vehicle record attached is a completely valid compliance
// document — a fleet customer driving in for an annual is the normal case — so a
// failed lookup must never block filing one.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShopCustomer, ShopJob, ShopTech, ShopVehicle } from '@/lib/types'
import { customerLabel, vehicleLabel } from './query'

export interface JobOption {
  id:          string
  job_number:  number
  description: string | null
  vehicle_id:  string | null
  customer_id: string | null
}

export interface VehicleOption {
  id:          string
  label:       string
  unit_number: string | null
  license:     string | null
  customer_id: string
  odometer:    number | null
}

export interface CustomerOption {
  id:      string
  label:   string
  address: string | null
}

export interface TechOption {
  id:   string
  name: string
}

export interface FormOptions {
  jobs:      JobOption[]
  vehicles:  VehicleOption[]
  customers: CustomerOption[]
  techs:     TechOption[]
}

/** Work orders still open enough to hang an inspection off. */
const OPEN_STATUSES = ['estimate', 'approved', 'in_progress', 'completed']

export async function loadFormOptions(
  supabase: SupabaseClient,
  shopId: string,
): Promise<FormOptions> {
  const [jobs, vehicles, customers, techs] = await Promise.all([
    supabase
      .from('shop_jobs')
      .select('id, job_number, description, vehicle_id, customer_id')
      .eq('shop_id', shopId)
      .eq('voided', false)
      .in('status', OPEN_STATUSES)
      .order('job_number', { ascending: false })
      .limit(100)
      .returns<Pick<ShopJob, 'id' | 'job_number' | 'description' | 'vehicle_id' | 'customer_id'>[]>(),
    supabase
      .from('shop_vehicles')
      .select('id, year, make, model, unit_number, vin, customer_id, mileage')
      .eq('shop_id', shopId)
      .order('unit_number', { ascending: true })
      .limit(500)
      .returns<
        Pick<
          ShopVehicle,
          'id' | 'year' | 'make' | 'model' | 'unit_number' | 'vin' | 'customer_id' | 'mileage'
        >[]
      >(),
    supabase
      .from('shop_customers')
      .select('id, first_name, last_name, company, address')
      .eq('shop_id', shopId)
      .order('last_name', { ascending: true })
      .limit(500)
      .returns<
        Pick<ShopCustomer, 'id' | 'first_name' | 'last_name' | 'company' | 'address'>[]
      >(),
    supabase
      .from('shop_techs')
      .select('id, first_name, last_name')
      .eq('shop_id', shopId)
      .eq('active', true)
      .order('first_name', { ascending: true })
      .returns<Pick<ShopTech, 'id' | 'first_name' | 'last_name'>[]>(),
  ])

  return {
    jobs: (jobs.data ?? []).map((job) => ({
      id:          job.id,
      job_number:  job.job_number,
      description: job.description,
      vehicle_id:  job.vehicle_id,
      customer_id: job.customer_id,
    })),
    vehicles: (vehicles.data ?? []).map((vehicle) => ({
      id:          vehicle.id,
      label:       vehicleLabel(vehicle),
      unit_number: vehicle.unit_number,
      // Vehicles carry no plate column; the inspector types it and it is stored
      // on the inspection, where the certificate needs it.
      license:     null,
      customer_id: vehicle.customer_id,
      odometer:    vehicle.mileage,
    })),
    customers: (customers.data ?? []).map((customer) => ({
      id:      customer.id,
      label:   customerLabel(customer),
      address: customer.address,
    })),
    techs: (techs.data ?? []).map((tech) => ({
      id:   tech.id,
      name: `${tech.first_name} ${tech.last_name}`.trim(),
    })),
  }
}

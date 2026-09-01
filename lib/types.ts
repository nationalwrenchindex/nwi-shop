// Shared row + domain types for NWI Shop. Every feature area imports from here so
// the build areas agree on one shape of the database.
//
// This file holds the CORE tables only — the ones more than one feature touches.
// Feature-specific tables keep their row type next to the code that owns them,
// so there is exactly one definition of each:
//   shop_inspections                  lib/shop/inspections/types.ts
//   shop_epa_log                      lib/shop/epa.ts
//   shop_review_requests / _settings  lib/shop/torquewrench/types.ts
//   shop_social_posts                 lib/shop/social.ts
//   shop_foreman_settings / _calls    lib/shop/foreman/settings.ts

export type ShopRole = 'manager' | 'foreman' | 'tech'
export type ShopTier = 'starter' | 'pro' | 'elite'

/**
 * What kind of work the shop does. Drives which diagnostic tools are reachable
 * and which price book applies — see lib/permissions.ts.
 *   ld            light duty
 *   hd            heavy duty
 *   full_service  both, priced higher
 */
export type ShopType = 'ld' | 'hd' | 'full_service'

export type BayType   = 'lift' | 'flat' | 'alignment' | 'other'
export type BayStatus = 'available' | 'occupied' | 'out_of_service'

export type JobStatus =
  | 'estimate'
  | 'approved'
  | 'in_progress'
  | 'completed'
  | 'invoiced'

export type LineItemType    = 'labor' | 'part'
export type PunchType       = 'shop' | 'job'
export type InventoryLoc    = 'shop' | 'vehicle'
export type InventoryTxType = 'received' | 'used' | 'adjusted' | 'returned'
export type SubStatus       = 'active' | 'past_due' | 'canceled' | 'incomplete' | 'trialing'

export interface ShopProfile {
  id:                string
  owner_id:          string
  business_name:     string
  logo_url:          string | null
  address:           string | null
  city:              string | null
  state:             string | null
  zip:               string | null
  phone:             string | null
  email:             string | null
  tax_rate:          number
  labor_rate:        number
  subscription_tier: ShopTier
  shop_type:         ShopType
  created_at:        string
  updated_at:        string
}

export interface ShopTech {
  id:         string
  shop_id:    string
  user_id:    string | null
  first_name: string
  last_name:  string
  email:      string | null
  phone:      string | null
  role:       ShopRole
  pay_rate:   number | null
  hire_date:  string | null
  active:     boolean
  created_at: string
}

export interface ShopBay {
  id:             string
  shop_id:        string
  label:          string
  type:           BayType
  status:         BayStatus
  current_job_id: string | null
  sort_order:     number
  created_at:     string
}

export interface ShopJob {
  id:               string
  shop_id:          string
  customer_id:      string | null
  vehicle_id:       string | null
  bay_id:           string | null
  assigned_tech_id: string | null
  job_number:       number
  status:           JobStatus
  description:      string | null
  complaint:        string | null
  notes:            string | null
  estimated_hours:  number | null
  bay_assigned_at:  string | null
  created_at:       string
  completed_at:     string | null
  invoiced_at:      string | null
  voided:           boolean
}

export interface ShopJobLineItem {
  id:           string
  job_id:       string
  shop_id:      string
  type:         LineItemType
  description:  string
  part_number:  string | null
  quantity:     number
  tech_id:      string | null
  unit_cost:    number
  unit_price:   number
  total:        number
  inventory_id: string | null
  created_at:   string
}

export interface ShopTimeclock {
  id:            string
  shop_id:       string
  tech_id:       string
  job_id:        string | null
  type:          PunchType
  punch_in:      string
  punch_out:     string | null
  total_minutes: number | null
  notes:         string | null
  created_at:    string
}

export interface ShopInventory {
  id:                string
  shop_id:           string
  location:          InventoryLoc
  part_number:       string
  description:       string
  manufacturer:      string | null
  quantity_on_hand:  number
  reorder_point:     number
  unit_cost:         number
  unit_price:        number
  vendor:            string | null
  created_at:        string
  updated_at:        string
}

export interface ShopInventoryTransaction {
  id:           string
  shop_id:      string
  inventory_id: string
  job_id:       string | null
  tech_id:      string | null
  type:         InventoryTxType
  quantity:     number
  cost:         number
  notes:        string | null
  created_at:   string
}

export interface ShopVehicle {
  id:          string
  shop_id:     string
  customer_id: string
  year:        number | null
  make:        string | null
  model:       string | null
  vin:         string | null
  engine:      string | null
  mileage:     number | null
  color:       string | null
  unit_number: string | null
  notes:       string | null
  created_at:  string
}

export interface ShopCustomer {
  id:         string
  shop_id:    string
  first_name: string
  last_name:  string
  company:    string | null
  email:      string | null
  phone:      string | null
  address:    string | null
  city:       string | null
  state:      string | null
  zip:        string | null
  no_sms:     boolean
  no_email:   boolean
  notes:      string | null
  created_at: string
}

export interface ShopSubscription {
  id:                     string
  shop_id:                string
  stripe_customer_id:     string | null
  stripe_subscription_id: string | null
  tier:                   ShopTier
  status:                 SubStatus
  active:                 boolean
  is_charter_member:      boolean
  foreman_ai:             boolean
  current_period_end:     string | null
  created_at:             string
  updated_at:             string
}

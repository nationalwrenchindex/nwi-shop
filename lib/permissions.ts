// Client-safe role + tier matrix. The single source of truth for what each of the
// three shop roles may see. Server code enforces the same rules again in RLS —
// this exists so the UI never renders a control the request would reject.

import type { ShopRole, ShopTier } from '@/lib/types'

export interface Permissions {
  /** Pay rates, payroll export, anything tied to what a person earns. */
  viewPayRates:    boolean
  /** Part cost, margin %, inventory value at cost. */
  viewMargins:     boolean
  runPayroll:      boolean
  /** false means the user is scoped to jobs assigned to them. */
  viewAllJobs:     boolean
  manageBays:      boolean
  manageTechs:     boolean
  manageInventory: boolean
  manageCustomers: boolean
  viewFinancials:  boolean
  manageBilling:   boolean
}

const MANAGER: Permissions = {
  viewPayRates:    true,
  viewMargins:     true,
  runPayroll:      true,
  viewAllJobs:     true,
  manageBays:      true,
  manageTechs:     true,
  manageInventory: true,
  manageCustomers: true,
  viewFinancials:  true,
  manageBilling:   true,
}

// Foreman runs the floor — job board, bays, techs, customers — but never sees
// what anyone is paid or what the shop makes on a part.
const FOREMAN: Permissions = {
  viewPayRates:    false,
  viewMargins:     false,
  runPayroll:      false,
  viewAllJobs:     true,
  manageBays:      true,
  manageTechs:     true,
  manageInventory: true,
  manageCustomers: true,
  viewFinancials:  false,
  manageBilling:   false,
}

// Tech sees their own jobs, their own clock, their own hours. Nothing else.
const TECH: Permissions = {
  viewPayRates:    false,
  viewMargins:     false,
  runPayroll:      false,
  viewAllJobs:     false,
  manageBays:      false,
  manageTechs:     false,
  manageInventory: false,
  manageCustomers: false,
  viewFinancials:  false,
  manageBilling:   false,
}

const MATRIX: Record<ShopRole, Permissions> = {
  manager: MANAGER,
  foreman: FOREMAN,
  tech:    TECH,
}

export function permissionsFor(role: ShopRole): Permissions {
  return MATRIX[role]
}

export function can(role: ShopRole, permission: keyof Permissions): boolean {
  return MATRIX[role][permission]
}

export const ROLE_LABELS: Record<ShopRole, string> = {
  manager: 'Shop Manager',
  foreman: 'Shop Foreman',
  tech:    'Shop Tech',
}

// ---------------------------------------------------------------------------
// Tier limits. `null` means unlimited.
// ---------------------------------------------------------------------------

export interface TierLimits {
  techs:       number | null
  bays:        number | null
  mobileUnits: number | null
  fleetPro:    boolean
  foremanAi:   boolean
}

export const TIER_LIMITS: Record<ShopTier, TierLimits> = {
  starter: { techs: 3,    bays: 2,    mobileUnits: 1,    fleetPro: false, foremanAi: false },
  pro:     { techs: 8,    bays: 6,    mobileUnits: 3,    fleetPro: false, foremanAi: false },
  // Foreman AI is a paid add-on even here — `foremanAi` only means "may purchase".
  elite:   { techs: null, bays: null, mobileUnits: null, fleetPro: true,  foremanAi: true  },
}

export const TIER_LABELS: Record<ShopTier, string> = {
  starter: 'NWI Shop Starter',
  pro:     'NWI Shop Pro',
  elite:   'NWI Shop Elite',
}

/** Monthly price in whole dollars. Foreman AI is always separate at $59/mo. */
export const TIER_PRICES: Record<ShopTier, number> = {
  starter: 119,
  pro:     199,
  elite:   299,
}

export const FOREMAN_AI_PRICE = 59

export function withinLimit(limit: number | null, current: number): boolean {
  return limit === null || current < limit
}

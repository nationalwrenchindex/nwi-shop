// Shared body parsing for the team routes. Kept out of route.ts because a Route
// Handler file may only export the HTTP method handlers and route segment config.

import type { ShopRole } from '@/lib/types'

const ROLES: ShopRole[] = ['manager', 'foreman', 'tech']

export interface TechPayload {
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  role: ShopRole
  pay_rate: number | null
  hire_date: string | null
  active: boolean
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Normalizes an incoming body down to the columns we are willing to write.
 * `allowPayRate` is the caller's viewPayRates permission: when false, pay_rate is
 * dropped from the payload entirely rather than defaulted, so a foreman can
 * neither read nor set it even with a hand-crafted request.
 */
export function parseTechBody(
  raw: unknown,
  allowPayRate: boolean,
): { data: Partial<TechPayload>; error: string | null } {
  if (typeof raw !== 'object' || raw === null) {
    return { data: {}, error: 'Invalid request body' }
  }
  const body = raw as Record<string, unknown>
  const data: Partial<TechPayload> = {}

  if ('first_name' in body) {
    const v = str(body.first_name)
    if (!v) return { data: {}, error: 'First name is required' }
    data.first_name = v
  }
  if ('last_name' in body) {
    const v = str(body.last_name)
    if (!v) return { data: {}, error: 'Last name is required' }
    data.last_name = v
  }
  if ('email' in body) data.email = str(body.email)
  if ('phone' in body) data.phone = str(body.phone)
  if ('hire_date' in body) data.hire_date = str(body.hire_date)
  if ('active' in body) data.active = Boolean(body.active)

  if ('role' in body) {
    const v = str(body.role)
    if (!v || !ROLES.includes(v as ShopRole)) return { data: {}, error: 'Invalid role' }
    data.role = v as ShopRole
  }

  if ('pay_rate' in body && allowPayRate) {
    const v = num(body.pay_rate)
    if (v !== null && v < 0) return { data: {}, error: 'Pay rate cannot be negative' }
    data.pay_rate = v
  }

  return { data, error: null }
}

/** Columns a caller without viewPayRates is allowed to read back. */
export const SAFE_TECH_COLUMNS =
  'id, shop_id, user_id, first_name, last_name, email, phone, role, hire_date, active, created_at'

// GET   /api/shop/customers/[id] - the customer plus their vehicles.
// PATCH /api/shop/customers/[id] - edit contact details.

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, asBoolean, asText, readJsonBody } from '@/lib/shop/jobs'
import type { ShopCustomer, ShopVehicle } from '@/lib/types'

type Params = { params: Promise<{ id: string }> }

/** Free-text columns a PATCH may set to a string or clear to null. */
const TEXT_FIELDS = [
  'company',
  'email',
  'phone',
  'address',
  'city',
  'state',
  'zip',
  'notes',
] as const

type CustomerPatch = Partial<Omit<ShopCustomer, 'id' | 'shop_id' | 'created_at'>>

export async function GET(_req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext('manageCustomers')
  if (error) return error

  const { id } = await params
  const supabase = await createClient()

  const { data: customer } = await supabase
    .from('shop_customers')
    .select('*')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<ShopCustomer>()
  if (!customer) return apiError('Customer not found.', 404)

  const { data: vehicles } = await supabase
    .from('shop_vehicles')
    .select('*')
    .eq('customer_id', customer.id)
    .eq('shop_id', ctx.shop.id)
    .order('created_at', { ascending: false })
    .returns<ShopVehicle[]>()

  return Response.json({ customer, vehicles: vehicles ?? [] })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext('manageCustomers')
  if (error) return error

  const { id } = await params
  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('shop_customers')
    .select('id')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<Pick<ShopCustomer, 'id'>>()
  if (!existing) return apiError('Customer not found.', 404)

  const patch: CustomerPatch = {}

  if ('first_name' in body) patch.first_name = asText(body.first_name) ?? ''
  if ('last_name' in body) patch.last_name = asText(body.last_name) ?? ''
  for (const field of TEXT_FIELDS) {
    if (field in body) patch[field] = asText(body[field])
  }
  if ('no_sms' in body) patch.no_sms = asBoolean(body.no_sms) ?? false
  if ('no_email' in body) patch.no_email = asBoolean(body.no_email) ?? false

  if (Object.keys(patch).length === 0) return apiError('Nothing to update.', 400)

  const { data: customer, error: updateError } = await supabase
    .from('shop_customers')
    .update(patch)
    .eq('id', existing.id)
    .eq('shop_id', ctx.shop.id)
    .select('*')
    .maybeSingle<ShopCustomer>()

  if (updateError || !customer) {
    return apiError(updateError?.message ?? 'Could not update the customer.', 400)
  }

  return Response.json({ customer })
}

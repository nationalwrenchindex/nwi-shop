// GET  /api/shop/vehicles?customer_id=  - vehicles for one customer (or the
//                                         shop's newest 50 without the filter).
// POST /api/shop/vehicles               - inline vehicle creation from the job
//                                         modal. `customer_id` is required and
//                                         must belong to the caller's shop.

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, asNumber, asText, readJsonBody } from '@/lib/shop/jobs'
import type { ShopCustomer, ShopVehicle } from '@/lib/types'

export async function GET(req: NextRequest) {
  const { ctx, error } = await apiContext('manageCustomers')
  if (error) return error

  const supabase = await createClient()
  const customerId = req.nextUrl.searchParams.get('customer_id')

  let query = supabase
    .from('shop_vehicles')
    .select('*')
    .eq('shop_id', ctx.shop.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (customerId) query = query.eq('customer_id', customerId)

  const { data } = await query.returns<ShopVehicle[]>()
  return Response.json({ vehicles: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await apiContext('manageCustomers')
  if (error) return error

  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const customerId = asText(body.customer_id)
  if (!customerId) return apiError('`customer_id` is required.', 400)

  const year = asNumber(body.year)
  if (year !== null && (year < 1900 || year > 2100)) {
    return apiError('That is not a valid model year.', 400)
  }
  const mileage = asNumber(body.mileage)
  if (mileage !== null && mileage < 0) return apiError('Mileage cannot be negative.', 400)

  const make = asText(body.make)
  const model = asText(body.model)
  const unitNumber = asText(body.unit_number)
  if (!make && !model && !unitNumber) {
    return apiError('A make, model, or unit number is required.', 400)
  }

  const supabase = await createClient()

  const { data: customer } = await supabase
    .from('shop_customers')
    .select('id')
    .eq('id', customerId)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<Pick<ShopCustomer, 'id'>>()
  if (!customer) return apiError('Customer not found in this shop.', 404)

  const { data: vehicle, error: insertError } = await supabase
    .from('shop_vehicles')
    .insert({
      shop_id:     ctx.shop.id,
      customer_id: customer.id,
      year,
      make,
      model,
      vin:         asText(body.vin),
      engine:      asText(body.engine),
      mileage,
      color:       asText(body.color),
      unit_number: unitNumber,
      notes:       asText(body.notes),
    })
    .select('*')
    .maybeSingle<ShopVehicle>()

  if (insertError || !vehicle) {
    return apiError(insertError?.message ?? 'Could not create the vehicle.', 400)
  }

  return Response.json({ vehicle }, { status: 201 })
}

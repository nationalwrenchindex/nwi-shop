// GET   /api/shop/vehicles/[id] - one vehicle, shop-scoped.
// PATCH /api/shop/vehicles/[id] - edit vehicle details (mileage on drop-off,
//                                 VIN, engine, unit number).

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, asNumber, asText, readJsonBody } from '@/lib/shop/jobs'
import type { ShopVehicle } from '@/lib/types'

type Params = { params: Promise<{ id: string }> }

const TEXT_FIELDS = ['make', 'model', 'vin', 'engine', 'color', 'unit_number', 'notes'] as const

type VehiclePatch = Partial<Omit<ShopVehicle, 'id' | 'shop_id' | 'customer_id' | 'created_at'>>

export async function GET(_req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext('manageCustomers')
  if (error) return error

  const { id } = await params
  const supabase = await createClient()

  const { data: vehicle } = await supabase
    .from('shop_vehicles')
    .select('*')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<ShopVehicle>()
  if (!vehicle) return apiError('Vehicle not found.', 404)

  return Response.json({ vehicle })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { ctx, error } = await apiContext('manageCustomers')
  if (error) return error

  const { id } = await params
  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('shop_vehicles')
    .select('id')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<Pick<ShopVehicle, 'id'>>()
  if (!existing) return apiError('Vehicle not found.', 404)

  const patch: VehiclePatch = {}

  for (const field of TEXT_FIELDS) {
    if (field in body) patch[field] = asText(body[field])
  }

  if ('year' in body) {
    const year = asNumber(body.year)
    if (year !== null && (year < 1900 || year > 2100)) {
      return apiError('That is not a valid model year.', 400)
    }
    patch.year = year
  }

  if ('mileage' in body) {
    const mileage = asNumber(body.mileage)
    if (mileage !== null && mileage < 0) return apiError('Mileage cannot be negative.', 400)
    patch.mileage = mileage
  }

  if (Object.keys(patch).length === 0) return apiError('Nothing to update.', 400)

  const { data: vehicle, error: updateError } = await supabase
    .from('shop_vehicles')
    .update(patch)
    .eq('id', existing.id)
    .eq('shop_id', ctx.shop.id)
    .select('*')
    .maybeSingle<ShopVehicle>()

  if (updateError || !vehicle) {
    return apiError(updateError?.message ?? 'Could not update the vehicle.', 400)
  }

  return Response.json({ vehicle })
}

// GET /api/shop/inventory/value — the valuation report. Gated on viewMargins:
// a foreman gets a 403 here, and the page never renders the card block for one.

import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { inventoryValue, isInventoryLoc, isLowStock } from '@/lib/shop/inventory'
import type { ShopInventory } from '@/lib/types'

export async function GET(request: Request) {
  const { ctx, error } = await apiContext('viewMargins')
  if (error) return error

  const url = new URL(request.url)
  const location = url.searchParams.get('location')

  const supabase = await createClient()

  let query = supabase
    .from('shop_inventory')
    .select('quantity_on_hand, reorder_point, unit_cost, unit_price')
    .eq('shop_id', ctx.shop.id)

  if (isInventoryLoc(location)) query = query.eq('location', location)

  const { data, error: dbError } = await query.returns<
    Pick<ShopInventory, 'quantity_on_hand' | 'reorder_point' | 'unit_cost' | 'unit_price'>[]
  >()

  if (dbError) {
    return Response.json(
      {
        value:         { atCost: 0, atSell: 0, marginPct: 0 },
        partCount:     0,
        unitCount:     0,
        lowStockCount: 0,
        warning:       dbError.message,
      },
      { status: 200 },
    )
  }

  const parts = data ?? []

  return Response.json({
    value:         inventoryValue(parts),
    partCount:     parts.length,
    unitCount:     parts.reduce((sum, p) => sum + (p.quantity_on_hand > 0 ? p.quantity_on_hand : 0), 0),
    lowStockCount: parts.filter(isLowStock).length,
  })
}

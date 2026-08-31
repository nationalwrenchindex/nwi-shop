// GET /api/shop/inventory/transactions — the movement history, filterable by
// type and date range. Readable by any shop member; the cost column is stripped
// for callers without viewMargins.

import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  isInventoryTxType,
  stripTransactionCost,
  type TransactionRow,
} from '@/lib/shop/inventory'
import type { ShopInventoryTransaction } from '@/lib/types'

const MAX_ROWS = 300

export async function GET(request: Request) {
  const { ctx, error } = await apiContext()
  if (error) return error

  const url = new URL(request.url)
  const type = url.searchParams.get('type')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const inventoryId = url.searchParams.get('inventory_id')
  const limitParam = Number(url.searchParams.get('limit'))
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_ROWS) : 100

  const supabase = await createClient()

  let query = supabase
    .from('shop_inventory_transactions')
    .select('*')
    .eq('shop_id', ctx.shop.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (isInventoryTxType(type)) query = query.eq('type', type)
  if (inventoryId) query = query.eq('inventory_id', inventoryId)
  if (from) query = query.gte('created_at', from)
  // `to` arrives as a plain date; include the whole day.
  if (to) query = query.lte('created_at', `${to}T23:59:59.999Z`)

  const { data, error: dbError } = await query.returns<ShopInventoryTransaction[]>()

  if (dbError) {
    return Response.json({ transactions: [], warning: dbError.message }, { status: 200 })
  }

  const rows = data ?? []
  const enriched = await enrich(rows, ctx.shop.id, ctx.permissions.viewMargins)

  return Response.json({ transactions: enriched })
}

/**
 * Resolves part / tech / job labels with plain id lookups instead of PostgREST
 * embeds, so the history still renders before the foreign keys exist.
 */
async function enrich(
  rows: ShopInventoryTransaction[],
  shopId: string,
  viewMargins: boolean,
): Promise<TransactionRow[]> {
  if (rows.length === 0) return []

  const supabase = await createClient()

  const partIds = [...new Set(rows.map((r) => r.inventory_id).filter(Boolean))]
  const techIds = [...new Set(rows.map((r) => r.tech_id).filter((v): v is string => !!v))]
  const jobIds = [...new Set(rows.map((r) => r.job_id).filter((v): v is string => !!v))]

  const [parts, techs, jobs] = await Promise.all([
    partIds.length
      ? supabase
          .from('shop_inventory')
          .select('id, part_number, description')
          .eq('shop_id', shopId)
          .in('id', partIds)
          .returns<{ id: string; part_number: string; description: string }[]>()
      : Promise.resolve({ data: [] }),
    techIds.length
      ? supabase
          .from('shop_techs')
          .select('id, first_name, last_name')
          .eq('shop_id', shopId)
          .in('id', techIds)
          .returns<{ id: string; first_name: string; last_name: string }[]>()
      : Promise.resolve({ data: [] }),
    jobIds.length
      ? supabase
          .from('shop_jobs')
          .select('id, job_number')
          .eq('shop_id', shopId)
          .in('id', jobIds)
          .returns<{ id: string; job_number: number }[]>()
      : Promise.resolve({ data: [] }),
  ])

  const partMap = new Map((parts.data ?? []).map((p) => [p.id, p]))
  const techMap = new Map((techs.data ?? []).map((t) => [t.id, t]))
  const jobMap = new Map((jobs.data ?? []).map((j) => [j.id, j]))

  return rows.map((row) => {
    const part = partMap.get(row.inventory_id)
    const tech = row.tech_id ? techMap.get(row.tech_id) : undefined
    const job = row.job_id ? jobMap.get(row.job_id) : undefined

    return {
      ...stripTransactionCost(row, viewMargins),
      part_number:      part?.part_number ?? null,
      part_description: part?.description ?? null,
      tech_name:        tech ? `${tech.first_name} ${tech.last_name}`.trim() : null,
      job_number:       job?.job_number ?? null,
    }
  })
}

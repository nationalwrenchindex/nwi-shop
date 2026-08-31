// Parts inventory. Everything on this page is filtered and redacted on the
// server: a caller without `viewMargins` (a foreman) never receives a
// `unit_cost` field at all, so the cost and margin columns and the valuation
// report cannot be recovered from the payload.

import type { Metadata } from 'next'
import { requireShop } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  inventoryValue,
  isInventoryLoc,
  isInventoryTxType,
  isLowStock,
  stripPartCost,
  stripTransactionCost,
  type PartView,
  type TransactionRow,
} from '@/lib/shop/inventory'
import type { ShopInventory, ShopInventoryTransaction } from '@/lib/types'
import AddPartDialog from './_components/add-part-dialog'
import InventoryToolbar from './_components/inventory-toolbar'
import LowStockBanner from './_components/low-stock-banner'
import PartsTable from './_components/parts-table'
import TransactionFilters from './_components/transaction-filters'
import TransactionHistory from './_components/transaction-history'
import ValueReport from './_components/value-report'

export const metadata: Metadata = { title: 'Inventory' }

interface InventoryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const TX_LIMIT = 100

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

function matches(part: ShopInventory, needle: string): boolean {
  if (!needle) return true
  const term = needle.toLowerCase()
  return (
    part.part_number.toLowerCase().includes(term) ||
    part.description.toLowerCase().includes(term) ||
    (part.manufacturer ?? '').toLowerCase().includes(term)
  )
}

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const ctx = await requireShop()
  const sp = await searchParams
  const supabase = await createClient()

  const query = first(sp.q).trim()
  const locationParam = first(sp.location)
  const location = isInventoryLoc(locationParam) ? locationParam : null

  const txTypeParam = first(sp.tx)
  const txType = isInventoryTxType(txTypeParam) ? txTypeParam : null
  const from = first(sp.from)
  const to = first(sp.to)

  const { viewMargins, manageInventory } = ctx.permissions

  // One read of the shop's parts covers the table, the low-stock banner, the
  // tab counts and the valuation; the search and location filters are then
  // applied here on the server before anything is sent to the browser.
  const { data: partsData, error: partsError } = await supabase
    .from('shop_inventory')
    .select('*')
    .eq('shop_id', ctx.shop.id)
    .order('part_number', { ascending: true })
    .returns<ShopInventory[]>()

  const allParts = partsData ?? []

  const visible = allParts.filter(
    (part) => (location === null || part.location === location) && matches(part, query),
  )

  const lowStock = allParts.filter(isLowStock)
  const counts = {
    all:     allParts.length,
    shop:    allParts.filter((p) => p.location === 'shop').length,
    vehicle: allParts.filter((p) => p.location === 'vehicle').length,
  }

  const value = inventoryValue(allParts)
  const unitCount = allParts.reduce(
    (sum, p) => sum + (p.quantity_on_hand > 0 ? p.quantity_on_hand : 0),
    0,
  )

  // Redaction happens here, at the server/client boundary.
  const redact = (part: ShopInventory): PartView => stripPartCost(part, viewMargins)
  const visibleParts = visible.map(redact)
  const selectableParts = allParts.filter((p) => p.quantity_on_hand > 0).map(redact)
  const lowStockParts = lowStock.map(redact)

  const transactions = await loadTransactions({
    shopId: ctx.shop.id,
    txType,
    from,
    to,
    viewMargins,
  })

  const filterState = {
    q:        query || undefined,
    location: location ?? undefined,
    tx:       txType ?? undefined,
    from:     from || undefined,
    to:       to || undefined,
  }

  return (
    <div className="pb-10">
      <LowStockBanner parts={lowStockParts} />

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory</h1>
          <p className="mt-1 text-sm text-slate-600">
            {counts.all} {counts.all === 1 ? 'part' : 'parts'} across shop stock and service
            vehicles
            {viewMargins ? '' : ' · part cost is managed by a shop manager'}
          </p>
        </div>
        {manageInventory ? <AddPartDialog viewMargins={viewMargins} /> : null}
      </header>

      {partsError ? (
        <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Inventory could not be loaded: {partsError.message}
        </p>
      ) : null}

      {viewMargins ? (
        <ValueReport
          value={value}
          partCount={allParts.length}
          unitCount={unitCount}
          lowStockCount={lowStock.length}
        />
      ) : null}

      <section className="mb-8">
        <InventoryToolbar
          query={query}
          location={location ?? 'all'}
          params={filterState}
          counts={counts}
        />
        <PartsTable
          parts={visibleParts}
          selectableParts={selectableParts}
          canManage={manageInventory}
          viewMargins={viewMargins}
          emptyHint={
            query || location
              ? 'No parts match this search.'
              : 'No parts yet. Add the first one to start tracking stock.'
          }
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Transaction history</h2>
        <div className="mb-3">
          <TransactionFilters
            type={txType ?? ''}
            from={from}
            to={to}
            params={filterState}
          />
        </div>
        <TransactionHistory rows={transactions} viewMargins={viewMargins} />
        {transactions.length === TX_LIMIT ? (
          <p className="mt-2 text-xs text-slate-500">
            Showing the {TX_LIMIT} most recent movements — narrow the date range to see older ones.
          </p>
        ) : null}
      </section>
    </div>
  )
}

/**
 * Movements plus their part / job / tech labels. The labels are resolved with
 * plain id lookups rather than PostgREST embeds so the history still renders
 * before the foreign keys exist in the database.
 */
async function loadTransactions({
  shopId,
  txType,
  from,
  to,
  viewMargins,
}: {
  shopId:      string
  txType:      ShopInventoryTransaction['type'] | null
  from:        string
  to:          string
  viewMargins: boolean
}): Promise<TransactionRow[]> {
  const supabase = await createClient()

  let query = supabase
    .from('shop_inventory_transactions')
    .select('*')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
    .limit(TX_LIMIT)

  if (txType) query = query.eq('type', txType)
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', `${to}T23:59:59.999Z`)

  const { data } = await query.returns<ShopInventoryTransaction[]>()
  const rows = data ?? []
  if (rows.length === 0) return []

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

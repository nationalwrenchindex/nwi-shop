// Inventory pricing + valuation math. Pure, dependency-free and importable from
// both server route handlers and client components — there is exactly one place
// in the app that knows how a sell price is derived from a cost.

import type {
  InventoryLoc,
  InventoryTxType,
  ShopInventory,
  ShopInventoryTransaction,
} from '@/lib/types'

/** House markup on parts: cost + 30%. */
export const DEFAULT_MARKUP = 0.3

/** Round to whole cents, guarding against float drift (0.1 + 0.2 problems). */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Sell price for a part at the given markup (default 30%), rounded to cents. */
export function sellPriceFromCost(cost: number, markup: number = DEFAULT_MARKUP): number {
  if (!Number.isFinite(cost) || cost <= 0) return 0
  return roundCents(cost * (1 + markup))
}

/**
 * Gross margin as a percentage of the sell price — the number a shop manager
 * actually quotes. 0 when the price is zero or below cost is irrelevant here;
 * a negative margin is reported honestly rather than clamped.
 */
export function marginPct(cost: number, price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0
  if (!Number.isFinite(cost)) return 0
  return Math.round(((price - cost) / price) * 1000) / 10
}

export interface ValuedPart {
  quantity_on_hand: number
  unit_cost: number
  unit_price: number
}

export interface InventoryValue {
  atCost: number
  atSell: number
  marginPct: number
}

/** Total on-hand valuation of a set of parts, at cost and at sell price. */
export function inventoryValue(parts: readonly ValuedPart[]): InventoryValue {
  let atCost = 0
  let atSell = 0

  for (const part of parts) {
    const qty = Number.isFinite(part.quantity_on_hand) ? part.quantity_on_hand : 0
    if (qty <= 0) continue
    atCost += qty * (Number.isFinite(part.unit_cost) ? part.unit_cost : 0)
    atSell += qty * (Number.isFinite(part.unit_price) ? part.unit_price : 0)
  }

  atCost = roundCents(atCost)
  atSell = roundCents(atSell)

  return { atCost, atSell, marginPct: marginPct(atCost, atSell) }
}

export interface StockablePart {
  quantity_on_hand: number
  reorder_point: number
}

/** At or below the reorder point — the trigger for the red banner. */
export function isLowStock(part: StockablePart): boolean {
  return part.quantity_on_hand <= part.reorder_point
}

// ---------------------------------------------------------------------------
// Cost redaction. A foreman may manage inventory but must never see unit cost
// or margin, so the server drops those keys from the payload entirely — the
// values never reach the browser, rather than being hidden with CSS.
// ---------------------------------------------------------------------------

export type PartView = Omit<ShopInventory, 'unit_cost'> & { unit_cost?: number }
export type TransactionView = Omit<ShopInventoryTransaction, 'cost'> & { cost?: number }

export function stripPartCost(part: ShopInventory, viewMargins: boolean): PartView {
  if (viewMargins) return part
  const { unit_cost: _cost, ...rest } = part
  void _cost
  return rest
}

export function stripTransactionCost(
  tx: ShopInventoryTransaction,
  viewMargins: boolean,
): TransactionView {
  if (viewMargins) return tx
  const { cost: _cost, ...rest } = tx
  void _cost
  return rest
}

// ---------------------------------------------------------------------------
// Display helpers + runtime narrowing for untrusted request bodies.
// ---------------------------------------------------------------------------

export const LOCATION_LABELS: Record<InventoryLoc, string> = {
  shop:    'Shop Stock',
  vehicle: 'Service Vehicle',
}

export const TX_TYPE_LABELS: Record<InventoryTxType, string> = {
  received: 'Received',
  used:     'Used',
  adjusted: 'Adjusted',
  returned: 'Returned',
}

export const TX_TYPE_BADGE: Record<InventoryTxType, string> = {
  received: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  used:     'bg-sky-50 text-sky-700 ring-sky-200',
  adjusted: 'bg-amber-50 text-amber-700 ring-amber-200',
  returned: 'bg-violet-50 text-violet-700 ring-violet-200',
}

export const INVENTORY_LOCATIONS: InventoryLoc[] = ['shop', 'vehicle']
export const INVENTORY_TX_TYPES: InventoryTxType[] = ['received', 'used', 'adjusted', 'returned']

export function isInventoryLoc(value: unknown): value is InventoryLoc {
  return value === 'shop' || value === 'vehicle'
}

export function isInventoryTxType(value: unknown): value is InventoryTxType {
  return (
    value === 'received' || value === 'used' || value === 'adjusted' || value === 'returned'
  )
}

export function formatMoney(value: number | null | undefined): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function formatPct(value: number): string {
  return `${(Number.isFinite(value) ? value : 0).toFixed(1)}%`
}

// ---------------------------------------------------------------------------
// Request-body coercion. Route handlers receive untrusted JSON; these keep the
// six inventory routes from each rolling their own parsing.
// ---------------------------------------------------------------------------

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** Number from JSON or a form value. Returns null when absent or unparseable. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Trimmed non-empty string, or null. */
export function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * A transaction joined to the human-readable bits the history table shows.
 * The API resolves these with follow-up lookups rather than PostgREST embeds so
 * it keeps working before the foreign keys are declared in the database.
 */
export interface TransactionRow extends TransactionView {
  part_number:      string | null
  part_description: string | null
  tech_name:        string | null
  job_number:       number | null
}

/** Strips PostgREST `or()` metacharacters out of a user-supplied search term. */
export function sanitizeSearch(term: string): string {
  return term.replace(/[,()%*\\]/g, ' ').trim()
}

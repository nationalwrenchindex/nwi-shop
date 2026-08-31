import { formatMoney, formatPct, type InventoryValue } from '@/lib/shop/inventory'

interface ValueReportProps {
  value:         InventoryValue
  partCount:     number
  unitCount:     number
  lowStockCount: number
}

/**
 * Inventory valuation. The whole block is rendered only for callers with
 * viewMargins — the page never mounts it for a foreman, and the API behind it
 * returns 403 for one.
 */
export default function ValueReport({
  value,
  partCount,
  unitCount,
  lowStockCount,
}: ValueReportProps) {
  const cards: { label: string; value: string; hint?: string; tone?: 'default' | 'warn' }[] = [
    { label: 'Value at cost',  value: formatMoney(value.atCost),  hint: `${unitCount} units on hand` },
    { label: 'Value at sell',  value: formatMoney(value.atSell),  hint: 'At current sell prices' },
    { label: 'Overall margin', value: formatPct(value.marginPct), hint: formatMoney(value.atSell - value.atCost) + ' gross' },
    { label: 'Distinct parts', value: String(partCount) },
    {
      label: 'Low stock',
      value: String(lowStockCount),
      hint:  lowStockCount > 0 ? 'Needs reordering' : 'All above reorder point',
      tone:  lowStockCount > 0 ? 'warn' : 'default',
    },
  ]

  return (
    <section className="mb-6">
      <h2 className="nwi-label mb-2">Inventory value</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="nwi-card p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {card.label}
            </p>
            <p
              className={`mt-1 text-xl font-bold tabular-nums ${
                card.tone === 'warn' ? 'text-red-700' : 'text-slate-900'
              }`}
            >
              {card.value}
            </p>
            {card.hint ? <p className="mt-0.5 text-xs text-slate-500">{card.hint}</p> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

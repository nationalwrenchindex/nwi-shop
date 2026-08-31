import { money, type JobLineItemView } from '@/lib/shop/jobs'

/**
 * Cost and margin columns exist only when `showMargins` is true AND the items
 * actually carry cost keys. The items are redacted on the server by
 * `toLineItemView`, so a foreman's payload has no cost to leak here.
 */
export default function LineItemsTable({
  title,
  items,
  quantityLabel,
  showMargins,
}: {
  title: string
  items: JobLineItemView[]
  quantityLabel: string
  showMargins: boolean
}) {
  const columns = showMargins ? 6 : 4

  return (
    <section className="nwi-card overflow-hidden">
      <h3 className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-600">
        {title}
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full min-w-lg text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2">Description</th>
              <th className="px-2 py-2 text-right">{quantityLabel}</th>
              {showMargins && <th className="px-2 py-2 text-right">Cost</th>}
              <th className="px-2 py-2 text-right">Price</th>
              <th className="px-4 py-2 text-right">Total</th>
              {showMargins && <th className="px-4 py-2 text-right">Margin</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 && (
              <tr>
                <td colSpan={columns} className="px-4 py-4 text-slate-500">
                  Nothing added yet.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr key={item.id} className="align-top">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-slate-900">{item.description}</div>
                  {item.part_number && (
                    <div className="font-mono text-xs text-slate-500">{item.part_number}</div>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right font-mono tabular-nums text-slate-800">
                  {item.quantity}
                </td>
                {showMargins && (
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums text-slate-600">
                    {item.unit_cost === undefined ? '--' : money(item.unit_cost)}
                  </td>
                )}
                <td className="px-2 py-2.5 text-right font-mono tabular-nums text-slate-800">
                  {money(item.unit_price)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                  {money(item.total)}
                </td>
                {showMargins && (
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-800">
                    {item.margin === undefined ? (
                      '--'
                    ) : (
                      <>
                        {money(item.margin)}
                        <span className="ml-1 text-xs text-slate-500">
                          {item.margin_pct ?? 0}%
                        </span>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

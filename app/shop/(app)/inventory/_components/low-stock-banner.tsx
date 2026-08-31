import { LOCATION_LABELS, type PartView } from '@/lib/shop/inventory'

/** The unmissable red bar at the top of the page. Renders nothing when every
 *  part is above its reorder point. */
export default function LowStockBanner({ parts }: { parts: PartView[] }) {
  if (parts.length === 0) return null

  return (
    <section className="mb-6 rounded-xl border-2 border-red-300 bg-red-50 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-bold uppercase tracking-wide text-red-800">
          Low stock — {parts.length} {parts.length === 1 ? 'part' : 'parts'} at or below reorder point
        </h2>
        <span className="text-sm text-red-700">Reorder before the next job needs them.</span>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2">
        {parts.map((part) => (
          <li
            key={part.id}
            className="flex items-baseline gap-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm"
          >
            <span className="font-mono font-semibold text-red-800">{part.part_number}</span>
            <span className="text-slate-700">{part.description}</span>
            <span className="text-xs text-slate-500">{LOCATION_LABELS[part.location]}</span>
            <span className="font-semibold text-red-700">
              {part.quantity_on_hand} / {part.reorder_point}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

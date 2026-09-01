// A small pill for a tool the shop cannot open yet. Two tones, and neither of
// them reads as an error: "Pro unlocks this" is an offer, "Coming soon" is a
// promise. Nothing here ever says "unavailable" or "denied" — a locked tool is
// not a broken tool, and a tech on the floor should never wonder if the app is
// failing.

const TONES = {
  // Amber: something the shop could have today by changing plans.
  upgrade: 'bg-amber-50 text-amber-900 ring-amber-200',
  // Slate: nothing to buy, it simply is not built yet.
  soon:    'bg-slate-100 text-slate-600 ring-slate-300',
} as const

export type LockedTone = keyof typeof TONES

export default function LockedBadge({
  label,
  tone = 'upgrade',
}: {
  label: string
  tone?: LockedTone
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${TONES[tone]}`}
    >
      {label}
    </span>
  )
}

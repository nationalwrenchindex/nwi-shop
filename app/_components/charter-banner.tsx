import { CHARTER_LIMIT } from '@/lib/shop/charter'

/**
 * The top-of-page charter urgency bar.
 *
 * Renders NOTHING when `slotsRemaining` is 0. That is the whole contract: when
 * the 50 spots are gone — or the count RPC failed and returned 0 — every trace of
 * charter messaging disappears from the page. There is deliberately no "0 spots
 * left" or "sold out" state; stale scarcity copy is worse than no copy.
 */
export default function CharterBanner({ slotsRemaining }: { slotsRemaining: number }) {
  if (slotsRemaining <= 0) return null

  return (
    <div className="relative isolate overflow-hidden bg-amber-500 text-slate-950">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2.5 text-center text-sm">
        <span className="inline-flex items-center gap-2 font-extrabold uppercase tracking-[0.12em]">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-slate-950/60" />
            <span className="relative inline-flex size-2 rounded-full bg-slate-950" />
          </span>
          {slotsRemaining} of {CHARTER_LIMIT} charter spots left
        </span>
        <span className="font-semibold">
          Your price is locked forever — no increases, ever.
        </span>
      </div>
    </div>
  )
}

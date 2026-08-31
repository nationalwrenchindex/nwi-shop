'use client'

import { useEffect, useState } from 'react'
import { formatElapsed } from '@/lib/shop/jobs'

/**
 * Live "3h 24m" counter for a bay. The first render is deliberately a dash:
 * the server has no idea what time it is on the tablet, so computing the span
 * only after mount avoids a hydration mismatch that would flash a wrong number.
 */
export default function Elapsed({
  since,
  className,
}: {
  since: string | null
  className?: string
}) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    if (!since) return
    const tick = () => setNow(Date.now())
    // The first value lands on the next frame rather than during the effect
    // body, so the initial paint still matches the server's dash.
    const frame = window.requestAnimationFrame(tick)
    const timer = window.setInterval(tick, 1000)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearInterval(timer)
    }
  }, [since])

  if (!since) return <span className={className}>--</span>

  const started = Date.parse(since)
  if (Number.isNaN(started)) return <span className={className}>--</span>

  return (
    <span className={className} suppressHydrationWarning>
      {now === null ? '--' : formatElapsed(now - started)}
    </span>
  )
}

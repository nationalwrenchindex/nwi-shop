'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A `Date` that ticks. Seeded from a server-rendered ISO string so the first
 * client render matches the server exactly, then advances on its own.
 */
export function useTickingNow(initialIso: string, intervalMs = 1000): Date {
  const [now, setNow] = useState<Date>(() => new Date(initialIso))

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}

/**
 * Polls a JSON endpoint on an interval and hands back the latest payload.
 * Overlapping requests are suppressed, and a failed poll keeps the last good
 * value on screen rather than blanking the board.
 */
export function usePolledJson<T>(
  url: string,
  initial: T,
  intervalMs: number,
): { data: T; stale: boolean; refresh: () => Promise<void> } {
  const [data, setData] = useState<T>(initial)
  const [stale, setStale] = useState(false)
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) {
        setStale(true)
        return
      }
      setData((await response.json()) as T)
      setStale(false)
    } catch {
      setStale(true)
    } finally {
      inFlight.current = false
    }
  }, [url])

  useEffect(() => {
    const id = setInterval(() => {
      void refresh()
    }, intervalMs)
    return () => clearInterval(id)
  }, [refresh, intervalMs])

  return { data, stale, refresh }
}

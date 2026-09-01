'use client'

// Canvas signature capture, ported from the National Wrench Index platform's
// SignaturePad and re-skinned for the light shop-floor surface.
//
// It lives in lib/shop/inspections rather than under either tool's `_components/`
// because BOTH tools sign the same way. A private folder under one route that the
// other route reaches into would make one page's UI the owner of the other's.
//
// Two details from the original are load-bearing and are kept verbatim in spirit:
// the backing store is scaled to devicePixelRatio (or the signature is a blurry
// smear on the tablet it is actually signed on), and the PNG is emitted on stroke
// end rather than per point, because toDataURL is expensive and the caller only
// needs the finished mark. It owns its own ref, so a page may host more than one.

import { useCallback, useEffect, useRef, useState } from 'react'

const INK = '#0f172a'

export default function SignaturePad({
  onChange,
  height = 150,
  disabled = false,
}: {
  /** Receives a PNG data URL, or null when cleared. */
  onChange: (dataUrl: string | null) => void
  height?: number
  disabled?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hasInk, setHasInk] = useState(false)

  // Held in refs so the drawing effect never re-subscribes when the parent
  // re-renders with a new callback identity. Written in effects rather than
  // during render — the listeners that read them only fire after commit.
  const onChangeRef = useRef(onChange)
  const disabledRef = useRef(disabled)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    disabledRef.current = disabled
  }, [disabled])

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    onChangeRef.current(null)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = canvas.clientWidth * dpr
    canvas.height = canvas.clientHeight * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = INK
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    let drawing = false
    let inked = false

    const pos = (event: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect()
      const source = 'touches' in event ? event.touches[0] : event
      return { x: source.clientX - rect.left, y: source.clientY - rect.top }
    }

    const start = (event: MouseEvent | TouchEvent) => {
      if (disabledRef.current) return
      event.preventDefault()
      drawing = true
      const { x, y } = pos(event)
      ctx.beginPath()
      ctx.moveTo(x, y)
    }

    const draw = (event: MouseEvent | TouchEvent) => {
      if (!drawing) return
      event.preventDefault()
      const { x, y } = pos(event)
      ctx.lineTo(x, y)
      ctx.stroke()
      if (!inked) {
        inked = true
        setHasInk(true)
      }
    }

    const end = () => {
      if (!drawing) return
      drawing = false
      if (inked) onChangeRef.current(canvas.toDataURL('image/png'))
    }

    canvas.addEventListener('mousedown', start)
    canvas.addEventListener('mousemove', draw)
    canvas.addEventListener('mouseup', end)
    canvas.addEventListener('mouseleave', end)
    canvas.addEventListener('touchstart', start, { passive: false })
    canvas.addEventListener('touchmove', draw, { passive: false })
    canvas.addEventListener('touchend', end)

    return () => {
      canvas.removeEventListener('mousedown', start)
      canvas.removeEventListener('mousemove', draw)
      canvas.removeEventListener('mouseup', end)
      canvas.removeEventListener('mouseleave', end)
      canvas.removeEventListener('touchstart', start)
      canvas.removeEventListener('touchmove', draw)
      canvas.removeEventListener('touchend', end)
    }
  }, [])

  return (
    <div>
      <canvas
        ref={canvasRef}
        aria-label="Inspector signature"
        className="w-full rounded-lg border border-slate-300 bg-white"
        style={{ height, touchAction: 'none', cursor: disabled ? 'not-allowed' : 'crosshair' }}
      />
      <div className="mt-1.5 flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {hasInk ? 'Signed' : 'Sign above with a finger, stylus or mouse'}
        </p>
        <button
          type="button"
          onClick={clear}
          className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-900"
        >
          Clear
        </button>
      </div>
    </div>
  )
}

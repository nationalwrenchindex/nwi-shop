'use client'

import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  title:    string
  subtitle?: string
  onClose:  () => void
  children: ReactNode
}

/** Shared dialog shell for the inventory modals. Escape closes; the backdrop is
 *  click-through-to-close, and the body scroll is locked while it is open. */
export default function Modal({ title, subtitle, onClose, children }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="nwi-card relative z-10 w-full max-w-lg p-5 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

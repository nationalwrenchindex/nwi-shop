'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface NavItem {
  href: string
  label: string
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Dark-slate shop navigation. Sidebar on desktop, collapsible drawer on tablet
 * and phone. Items are pre-filtered by permission on the server — this component
 * renders whatever it is handed and makes no authorization decision of its own.
 */
export default function ShopNav({
  items,
  businessName,
  userName,
  roleLabel,
  signOut,
}: {
  items: NavItem[]
  businessName: string
  userName: string
  roleLabel: string
  signOut: ReactNode
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const links = (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={`rounded-lg px-3 py-3 text-[0.9375rem] font-semibold transition-colors ${
              active
                ? 'bg-slate-700 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )

  const identity = (
    <div className="border-t border-slate-800 pt-4">
      <p className="truncate text-sm font-semibold text-white">{userName}</p>
      <p className="text-xs uppercase tracking-wider text-slate-400">{roleLabel}</p>
      <div className="mt-3">{signOut}</div>
    </div>
  )

  return (
    <>
      {/* Mobile / tablet top bar */}
      <header className="flex items-center justify-between bg-slate-900 px-4 py-3 lg:hidden">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-white">{businessName}</p>
          <p className="text-xs text-slate-400">{roleLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200"
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </header>

      {open ? (
        <div className="bg-slate-900 px-4 pb-5 lg:hidden">
          {links}
          <div className="mt-4">{identity}</div>
        </div>
      ) : null}

      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col justify-between bg-slate-900 p-4 lg:flex">
        <div>
          <Link href="/shop" className="block px-3 pb-5 pt-2">
            <span className="block text-lg font-bold leading-tight text-white">
              {businessName}
            </span>
            <span className="block text-xs uppercase tracking-widest text-slate-500">
              NWI Shop
            </span>
          </Link>
          {links}
        </div>
        {identity}
      </aside>
    </>
  )
}

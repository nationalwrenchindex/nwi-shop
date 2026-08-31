import Link from 'next/link'
import { COMPANY_NAME, PRODUCT_NAME, SUPPORT_EMAIL } from '@/lib/branding'

export default function SiteFooter({ slotsRemaining }: { slotsRemaining: number }) {
  return (
    <footer className="border-t border-white/10 bg-slate-950">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-10">
          <div className="max-w-sm">
            <span className="text-sm font-black uppercase tracking-[0.22em] text-white">
              {PRODUCT_NAME}
            </span>
            <p className="mt-4 text-sm leading-relaxed text-slate-400">
              Shop management built for the people turning the wrenches. From{' '}
              {COMPANY_NAME}.
            </p>
          </div>

          <div className="flex flex-wrap gap-x-14 gap-y-8 text-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                Product
              </p>
              <ul className="mt-4 space-y-2.5">
                <li>
                  <Link href="#pricing" className="text-slate-300 hover:text-white">
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link href="/shop/signup" className="text-slate-300 hover:text-white">
                    Start your shop
                  </Link>
                </li>
                <li>
                  <Link href="/login" className="text-slate-300 hover:text-white">
                    Sign in
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                Support
              </p>
              <ul className="mt-4 space-y-2.5">
                <li>
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="text-slate-300 hover:text-white"
                  >
                    {SUPPORT_EMAIL}
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-14 border-t border-white/10 pt-8">
          {/* At 0 slots the charter clause is dropped along with every other
              charter callout on the page — the line degrades to the evergreen
              half rather than advertising an offer that is closed. */}
          <p className="text-sm font-semibold text-white">
            No contracts. Cancel anytime.
            {slotsRemaining > 0 ? ' Price locked forever for charter members.' : ''}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            © {new Date().getFullYear()} {COMPANY_NAME}. All rights reserved. Fullbay
            and ShopMonkey are trademarks of their respective owners and are not
            affiliated with {PRODUCT_NAME}.
          </p>
        </div>
      </div>
    </footer>
  )
}

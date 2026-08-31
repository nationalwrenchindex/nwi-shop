// Authenticated shell for every /shop route. proxy.ts has already confirmed a
// session exists; requireShop() is what resolves the caller to a shop + role,
// and the nav below is filtered by that role's permissions.

import { requireShop } from '@/lib/auth'
import { ROLE_LABELS } from '@/lib/permissions'
import ShopNav, { type NavItem } from '@/components/shop-nav'
import SignOutButton from '@/components/sign-out-button'

export default async function ShopLayout({ children }: LayoutProps<'/shop'>) {
  const { shop, tech, role, permissions } = await requireShop()

  const items: NavItem[] = [
    { href: '/shop', label: 'Dashboard' },
    { href: '/shop/jobs', label: 'Job Board' },
    { href: '/shop/timeclock', label: 'Timeclock' },
  ]
  if (permissions.manageBays) items.push({ href: '/shop/bays', label: 'Bays' })
  if (permissions.manageInventory) items.push({ href: '/shop/inventory', label: 'Inventory' })
  if (permissions.manageTechs) items.push({ href: '/shop/team', label: 'Team' })
  if (permissions.viewFinancials) items.push({ href: '/shop/financials', label: 'Financials' })
  if (permissions.manageBilling) items.push({ href: '/shop/billing', label: 'Billing' })

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 lg:flex-row">
      <ShopNav
        items={items}
        businessName={shop.business_name}
        userName={`${tech.first_name} ${tech.last_name}`.trim()}
        roleLabel={ROLE_LABELS[role]}
        signOut={<SignOutButton />}
      />
      <main className="flex-1 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  )
}

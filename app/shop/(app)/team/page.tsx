import type { Metadata } from 'next'
import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { TIER_LABELS, TIER_LIMITS } from '@/lib/permissions'
import type { ShopTech } from '@/lib/types'
import { SAFE_TECH_COLUMNS } from '@/app/api/shop/team/_payload'
import PageHeader from '@/components/page-header'
import TeamManager from './_components/team-manager'

export const metadata: Metadata = { title: 'Team' }

export default async function TeamPage() {
  // Route-level role gate. proxy.ts only proved a session exists.
  const ctx = await requirePermission('manageTechs')
  const supabase = await createClient()

  // Pay rate is not merely hidden in the UI — a caller without viewPayRates
  // never has the column selected, so it never reaches the browser at all.
  const columns = ctx.permissions.viewPayRates ? '*' : SAFE_TECH_COLUMNS

  let techs: ShopTech[] = []
  let loadError: string | null = null

  // Deliberate graceful degradation: an unapplied migration shows an empty
  // roster with a notice instead of a 500.
  try {
    const { data, error } = await supabase
      .from('shop_techs')
      .select(columns)
      .eq('shop_id', ctx.shop.id)
      .order('active', { ascending: false })
      .order('last_name', { ascending: true })
      .returns<ShopTech[]>()

    if (error) loadError = error.message
    else techs = data ?? []
  } catch {
    loadError = 'Could not load the roster.'
  }

  const tier = ctx.subscription?.tier ?? ctx.shop.subscription_tier
  const seatLimit = TIER_LIMITS[tier].techs
  const activeCount = techs.filter((t) => t.active).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        subtitle={
          seatLimit === null
            ? `${TIER_LABELS[tier]} · unlimited tech seats`
            : `${TIER_LABELS[tier]} · ${activeCount} of ${seatLimit} tech seats used`
        }
      />

      {loadError ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          The roster could not be loaded ({loadError}). Showing an empty list.
        </p>
      ) : null}

      <TeamManager
        initialTechs={techs}
        canViewPayRates={ctx.permissions.viewPayRates}
        isManager={ctx.role === 'manager'}
        currentTechId={ctx.tech.id}
        seatLimit={seatLimit}
      />
    </div>
  )
}

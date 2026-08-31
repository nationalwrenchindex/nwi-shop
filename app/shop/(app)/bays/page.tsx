// Bay setup. The job board renders bays but cannot create them, so without this
// screen a new shop lands on an empty board with no way to populate it.

import type { Metadata } from 'next'
import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { TIER_LABELS, TIER_LIMITS } from '@/lib/permissions'
import type { ShopBay } from '@/lib/types'
import PageHeader from '@/components/page-header'
import BayManager from './_components/bay-manager'

export const metadata: Metadata = { title: 'Bays' }

export default async function BaysPage() {
  const ctx = await requirePermission('manageBays')
  const supabase = await createClient()

  // Degrades to an empty list rather than crashing when the migrations have not
  // been applied yet — same posture as the rest of the app.
  let bays: ShopBay[] = []
  try {
    const { data } = await supabase
      .from('shop_bays')
      .select('*')
      .eq('shop_id', ctx.shop.id)
      .order('sort_order', { ascending: true })
      .returns<ShopBay[]>()
    bays = data ?? []
  } catch {
    bays = []
  }

  // The subscription row is authoritative when present; the profile tier is the
  // fallback for a shop that has not finished checkout.
  const tier = ctx.subscription?.tier ?? ctx.shop.subscription_tier

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bays"
        subtitle="Set up the bays that appear on the job board."
      />
      <BayManager
        initialBays={bays}
        limit={TIER_LIMITS[tier].bays}
        tierLabel={TIER_LABELS[tier]}
      />
    </div>
  )
}

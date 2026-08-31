// /shop/tools/quickwrench-ld — gated on the shop TYPE, not the user's role.
// requireFeature() is the FIRST statement in the component, so a heavy-duty-only shop
// is redirected to /shop before any of this page renders.

import type { Metadata } from 'next'
import { requireFeature } from '@/lib/auth'
import { FEATURE_LABELS } from '@/lib/permissions'
import ToolPlaceholder from '../_components/tool-placeholder'

export const metadata: Metadata = { title: FEATURE_LABELS.quickwrench_ld }

export default async function QuickWrenchLdPage() {
  await requireFeature('quickwrench_ld')

  return <ToolPlaceholder feature="quickwrench_ld" />
}

// /shop/tools/trailer-abs — gated on the shop TYPE, not the user's role.
// requireFeature() is the FIRST statement in the component, so a light-duty shop
// is redirected to /shop before any of this page renders.

import type { Metadata } from 'next'
import { requireFeature } from '@/lib/auth'
import { FEATURE_LABELS } from '@/lib/permissions'
import ToolPlaceholder from '../_components/tool-placeholder'

export const metadata: Metadata = { title: FEATURE_LABELS.trailer_abs }

export default async function TrailerAbsPage() {
  await requireFeature('trailer_abs')

  return <ToolPlaceholder feature="trailer_abs" />
}

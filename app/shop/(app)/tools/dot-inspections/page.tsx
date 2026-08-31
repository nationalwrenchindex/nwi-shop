// /shop/tools/dot-inspections — gated on the shop TYPE, not the user's role.
// requireFeature() is the FIRST statement in the component, so a light-duty shop
// is redirected to /shop before any of this page renders.

import type { Metadata } from 'next'
import { requireFeature } from '@/lib/auth'
import { FEATURE_LABELS } from '@/lib/permissions'
import ToolPlaceholder from '../_components/tool-placeholder'

export const metadata: Metadata = { title: FEATURE_LABELS.dot_inspections }

export default async function DotInspectionsPage() {
  await requireFeature('dot_inspections')

  return <ToolPlaceholder feature="dot_inspections" />
}

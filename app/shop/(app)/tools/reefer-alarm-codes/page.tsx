// /shop/tools/reefer-alarm-codes — gated on the shop TYPE, not the user's role.
// requireFeature() is the FIRST statement in the component, so a light-duty shop
// is redirected to /shop before any of this page renders.

import type { Metadata } from 'next'
import { requireFeature } from '@/lib/auth'
import { FEATURE_LABELS } from '@/lib/permissions'
import ToolPlaceholder from '../_components/tool-placeholder'

export const metadata: Metadata = { title: FEATURE_LABELS.reefer_alarm_codes }

export default async function ReeferAlarmCodesPage() {
  await requireFeature('reefer_alarm_codes')

  return <ToolPlaceholder feature="reefer_alarm_codes" />
}

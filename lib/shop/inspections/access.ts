// Which of the two inspection features a request needs.
//
// `dot_inspections` and `aerial_inspections` are separate ShopFeature values, so
// the gate depends on the row's `type`. apiFeature() takes one feature and the
// list endpoint serves both, which is why the resolution lives here rather than
// being inlined at three call sites with three slightly different messages.
//
// NWI Suite's aerial POST route had no tier gate at all — only a getUser() check —
// so any signed-in account could write aerial compliance records. Every entry
// point in this feature runs through one of these helpers.

import {
  FEATURE_LABELS,
  FEATURE_MIN_TIER,
  featureBlock,
  hasFeature,
  type ShopFeature,
} from '@/lib/permissions'
import type { ShopTier, ShopType } from '@/lib/types'
import { INSPECTION_TYPES, type InspectionType } from './types'

export function featureForType(type: InspectionType): ShopFeature {
  return type === 'dot' ? 'dot_inspections' : 'aerial_inspections'
}

/** The subset of a ShopContext these checks read. */
export interface FeatureSubject {
  shopType: ShopType
  tier:     ShopTier
}

export function canUseInspectionType(ctx: FeatureSubject, type: InspectionType): boolean {
  return hasFeature(ctx.shopType, ctx.tier, featureForType(type))
}

/** The inspection types this shop may read or write. Empty means no access at all. */
export function allowedInspectionTypes(ctx: FeatureSubject): InspectionType[] {
  return INSPECTION_TYPES.filter((type) => canUseInspectionType(ctx, type))
}

/**
 * Distinguishes "your shop type does not do this work" from "upgrade your plan",
 * matching the wording apiFeature() produces for the single-feature routes.
 */
export function inspectionFeatureMessage(
  ctx: FeatureSubject,
  type: InspectionType,
): string {
  const feature = featureForType(type)
  return featureBlock(ctx.shopType, ctx.tier, feature) === 'tier_too_low'
    ? `${FEATURE_LABELS[feature]} requires the ${FEATURE_MIN_TIER[feature]} plan or higher.`
    : `${FEATURE_LABELS[feature]} is not included for your shop type.`
}

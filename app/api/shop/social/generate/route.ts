// POST /api/shop/social/generate — draft one post per platform for THIS shop.
//
// Gated on the `social_posts` feature (every shop type, pro tier and up) plus
// manageCustomers, because these posts go out under the shop's name.
//
// Nothing here publishes anything. Rows land in `shop_social_posts` with status
// 'pending' and wait for a human.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, readJsonBody } from '@/lib/shop/jobs'
import {
  MISSING_TABLE_MESSAGE,
  generateSocialDrafts,
  isMissingTable,
  promptInputForShop,
  type ShopSocialPost,
} from '@/lib/shop/social'

/** Reads an optional caller-supplied service list; anything else is ignored. */
function servicesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 25)
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await apiFeature('social_posts', 'manageCustomers')
  if (error) return error

  const body = (await readJsonBody(req)) ?? {}
  const services = servicesFrom(body.services)

  const input = promptInputForShop(ctx.shop, ctx.shopType, services)
  const result = await generateSocialDrafts(input)

  if (!result.ok) {
    // no_provider is a deployment problem, not a bad request.
    return apiError(result.error, result.code === 'no_provider' ? 503 : 502)
  }

  const supabase = await createClient()

  const { data, error: insertError } = await supabase
    .from('shop_social_posts')
    .insert(
      result.drafts.map((draft) => ({
        shop_id:           ctx.shop.id,
        platform:          draft.platform,
        content:           draft.content,
        visual_suggestion: draft.visual_suggestion || null,
        image_prompt:      draft.image_prompt || null,
        // No image provider is configured. The column stays null rather than
        // carrying a placeholder that would look like a generated image.
        image_url:         null,
        theme:             draft.theme,
        status:            'pending',
        tech_id:           ctx.tech.id,
      })),
    )
    .select('*')
    .returns<ShopSocialPost[]>()

  if (insertError) {
    if (isMissingTable(insertError)) return apiError(MISSING_TABLE_MESSAGE, 503)
    return apiError(insertError.message, 400)
  }

  return Response.json(
    { posts: data ?? [], theme: input.theme, provider: result.provider },
    { status: 201 },
  )
}

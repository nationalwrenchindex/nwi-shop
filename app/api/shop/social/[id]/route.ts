// GET    /api/shop/social/[id] — read one drafted post
// PATCH  /api/shop/social/[id] — edit the copy, or approve / mark posted
// DELETE /api/shop/social/[id] — discard (soft: status becomes 'discarded')
//
// Next 16: `context.params` is a Promise and must be awaited.
//
// "Approved" and "posted" are bookkeeping states a human sets. NWI Shop has no
// connection to any social network — nothing in this file publishes anything.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, asText, readJsonBody } from '@/lib/shop/jobs'
import {
  MISSING_TABLE_MESSAGE,
  isMissingTable,
  isSocialPostStatus,
  type ShopSocialPost,
} from '@/lib/shop/social'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, context: RouteContext) {
  const { ctx, error } = await apiFeature('social_posts', 'manageCustomers')
  if (error) return error

  const { id } = await context.params
  const supabase = await createClient()

  const { data, error: readError } = await supabase
    .from('shop_social_posts')
    .select('*')
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .maybeSingle<ShopSocialPost>()

  if (readError) {
    if (isMissingTable(readError)) return apiError(MISSING_TABLE_MESSAGE, 503)
    return apiError(readError.message, 400)
  }
  if (!data) return apiError('Post not found in this shop.', 404)

  return Response.json({ post: data })
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { ctx, error } = await apiFeature('social_posts', 'manageCustomers')
  if (error) return error

  const { id } = await context.params
  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const patch: Partial<
    Pick<ShopSocialPost, 'content' | 'visual_suggestion' | 'image_prompt' | 'status'>
  > = {}

  if ('content' in body) {
    const content = asText(body.content)
    if (!content) return apiError('Post content cannot be empty.', 400)
    patch.content = content
  }
  if ('visual_suggestion' in body) patch.visual_suggestion = asText(body.visual_suggestion)
  if ('image_prompt' in body) patch.image_prompt = asText(body.image_prompt)

  if ('status' in body) {
    if (!isSocialPostStatus(body.status)) return apiError('Unknown post status.', 400)
    patch.status = body.status
  }

  if (Object.keys(patch).length === 0) {
    return apiError('Nothing to update.', 400)
  }

  const supabase = await createClient()
  const { data, error: updateError } = await supabase
    .from('shop_social_posts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .select('*')
    .maybeSingle<ShopSocialPost>()

  if (updateError) {
    if (isMissingTable(updateError)) return apiError(MISSING_TABLE_MESSAGE, 503)
    return apiError(updateError.message, 400)
  }
  if (!data) return apiError('Post not found in this shop.', 404)

  return Response.json({ post: data })
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { ctx, error } = await apiFeature('social_posts', 'manageCustomers')
  if (error) return error

  const { id } = await context.params
  const supabase = await createClient()

  // Discard rather than delete: a shop that throws away a draft should still be
  // able to see what was suggested, and the table is small.
  const { data, error: updateError } = await supabase
    .from('shop_social_posts')
    .update({ status: 'discarded', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('shop_id', ctx.shop.id)
    .select('*')
    .maybeSingle<ShopSocialPost>()

  if (updateError) {
    if (isMissingTable(updateError)) return apiError(MISSING_TABLE_MESSAGE, 503)
    return apiError(updateError.message, 400)
  }
  if (!data) return apiError('Post not found in this shop.', 404)

  return Response.json({ post: data })
}

// /shop/tools/social-posts — drafts social copy in the SHOP's voice.
//
// requireFeature() is the first statement: `social_posts` is available to every
// shop type at the pro tier and up, so a starter shop never renders this page.
//
// The copy on this page is deliberately blunt about two things: nothing is
// published automatically (there is no social-network integration anywhere in
// NWI Shop), and no images are generated (no image provider is configured).

import type { Metadata } from 'next'
import { requireFeature } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { FEATURE_LABELS } from '@/lib/permissions'
import PageHeader from '@/components/page-header'
import {
  IMAGE_GENERATION_NOTE,
  MISSING_TABLE_MESSAGE,
  NO_AUTOPUBLISH_NOTE,
  isMissingTable,
  socialProviderAvailable,
  themeForDate,
  type ShopSocialPost,
} from '@/lib/shop/social'
import SocialBoard from './_components/social-board'

export const metadata: Metadata = { title: FEATURE_LABELS.social_posts }

export default async function SocialPostsPage() {
  const ctx = await requireFeature('social_posts')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('shop_social_posts')
    .select('*')
    .eq('shop_id', ctx.shop.id)
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<ShopSocialPost[]>()

  const tableMissing = isMissingTable(error)
  const posts = data ?? []
  const provider = socialProviderAvailable()

  return (
    <div className="space-y-6">
      <PageHeader
        title={FEATURE_LABELS.social_posts}
        subtitle={`Drafts written in ${ctx.shop.business_name}'s voice, from your own shop record. Review every one before it goes anywhere.`}
      />

      {/* Not .nwi-card: that rule is unlayered CSS, so its white background beats
          Tailwind's layered color utilities. A colored panel spells itself out. */}
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-base font-semibold text-amber-900">
          Nothing on this page posts itself
        </h2>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-amber-900/90">
          <li>{NO_AUTOPUBLISH_NOTE}</li>
          <li>{IMAGE_GENERATION_NOTE}</li>
          <li>
            Drafts are written only from what is on your shop profile — business
            name, city and state, shop type, labor rate and the services you
            list. Nothing else about your shop is known, so read every draft
            before you use it.
          </li>
        </ul>
      </section>

      {tableMissing ? (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-5">
          <h2 className="text-base font-semibold text-rose-900">Not set up yet</h2>
          <p className="mt-2 text-sm leading-relaxed text-rose-900/90">
            {MISSING_TABLE_MESSAGE}
          </p>
        </section>
      ) : null}

      {provider === null ? (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-5">
          <h2 className="text-base font-semibold text-rose-900">
            No writing service is connected
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-rose-900/90">
            Neither <code>GEMINI_API_KEY</code> nor <code>ANTHROPIC_API_KEY</code> is
            set for this deployment, so nothing can be drafted. Existing drafts
            below still open and edit normally.
          </p>
        </section>
      ) : null}

      <SocialBoard
        initialPosts={posts}
        canManage={ctx.permissions.manageCustomers}
        canGenerate={ctx.permissions.manageCustomers && provider !== null && !tableMissing}
        todaysTheme={themeForDate()}
      />
    </div>
  )
}

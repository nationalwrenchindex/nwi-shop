-- ============================================================
-- NWI Shop
-- Migration: 012_shop_social_posts.sql
-- shop_social_posts — AI-drafted social content, held for a human to approve.
-- Run this entire file in your Supabase SQL Editor, after 011.
-- ============================================================
--
-- THE POINT OF THIS TABLE IS THE HOLDING PEN.
--
-- Content is generated in bulk and posted one at a time by a person who read
-- it first. Nothing here is published by writing a row; `status` starts at
-- 'pending' and only a human moves it. That is why the table exists at all
-- rather than the app generating a caption and posting it in the same
-- request — a shop's public voice does not get to be an unreviewed model
-- output.
--
-- The image is stored twice over: `image_prompt` is what was asked for and
-- `image_url` is what came back. Keeping the prompt means a rejected image can
-- be regenerated without re-deriving the idea, and it is the only record of
-- what the model was told once the URL expires.
-- ============================================================


-- ============================================================
-- SHOP SOCIAL POSTS
-- ============================================================
create table if not exists public.shop_social_posts (
  id                uuid        primary key default gen_random_uuid(),
  shop_id           uuid        not null references public.shop_profiles(id) on delete cascade,

  -- Constrained, because each platform has different length and formatting
  -- rules and the composer branches on all five. A sixth platform is a check
  -- constraint edit plus a branch — deliberately not a silent free-text value
  -- that renders wrong.
  platform          text        not null
                                check (platform in ('tiktok', 'instagram', 'facebook',
                                                    'linkedin', 'twitter')),

  -- The caption. NOT NULL: a post with no words is not a draft of anything.
  content           text        not null,

  -- What to film or photograph, in plain English, for the person holding the
  -- phone. Distinct from image_prompt below, which is written for a model.
  visual_suggestion text,

  -- The generation prompt, kept verbatim. See the header note.
  image_prompt      text,
  image_url         text,

  -- The content pillar this draft came from — "before and after", "shop
  -- tour", "tech spotlight". Free text rather than an enum: the themes are a
  -- marketing decision that changes monthly and belongs in application config,
  -- not in DDL.
  theme             text,

  --   pending    generated, waiting on a human
  --   approved   cleared to post
  --   posted     actually published
  --   discarded  rejected
  -- 'discarded' is why the delete policy below can be staff-only without
  -- getting in anyone's way: rejecting a draft is a status change, not a
  -- delete, and it keeps the record of what the generator produced.
  status            text        not null default 'pending'
                                check (status in ('pending', 'approved', 'posted', 'discarded')),

  -- Who generated or claimed the draft. SET NULL, as everywhere else in this
  -- schema: a tech leaving must not delete the shop's content queue.
  tech_id           uuid        references public.shop_techs(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_shop_social_posts_shop_id
  on public.shop_social_posts(shop_id);

-- The queue screen: one shop, filtered by state, newest first.
create index if not exists idx_shop_social_posts_shop_status
  on public.shop_social_posts(shop_id, status, created_at desc);

-- Serves the tech-scoped write policies below.
create index if not exists idx_shop_social_posts_tech_id
  on public.shop_social_posts(tech_id)
  where tech_id is not null;

drop trigger if exists set_shop_social_posts_updated_at on public.shop_social_posts;
create trigger set_shop_social_posts_updated_at
  before update on public.shop_social_posts
  for each row execute procedure public.shop_set_updated_at();

comment on table public.shop_social_posts is
  'AI-drafted social content held at status = pending until a human approves it. image_prompt (what was asked for) is kept alongside image_url (what came back) so a draft can be regenerated after the URL expires.';


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.shop_social_posts enable row level security;

grant select, insert, update, delete on public.shop_social_posts to authenticated;
revoke all on public.shop_social_posts from anon;

-- READ: the whole shop. Nothing in here is confidential — it is marketing copy
-- about the shop, written to be seen by strangers — and a tech who took the
-- before-and-after photo should be able to see the draft it produced.
--
-- Note that anon is granted nothing anyway: a post is published by pushing it
-- to the platform, never by a visitor reading this table.
drop policy if exists "shop_social_posts: select own shop" on public.shop_social_posts;
create policy "shop_social_posts: select own shop"
  on public.shop_social_posts for select
  to authenticated
  using (shop_id = public.shop_current_shop_id());

-- WRITE: staff freely; a tech only on rows carrying their own tech_id.
--
-- No shop_job_visible() test here — a social post does not hang off a job, so
-- there is no job scoping to match. The tech_id rule is the whole constraint,
-- and it is in WITH CHECK as well as USING so a tech cannot move a draft onto
-- a colleague.
--
-- What this does NOT do is stop a tech setting status = 'approved' on their
-- own draft. RLS compares column values, it does not know which transition is
-- legitimate; approval is an application-layer rule, and if it has to be a
-- database boundary the fix is a BEFORE UPDATE trigger, not a policy.
drop policy if exists "shop_social_posts: insert own shop" on public.shop_social_posts;
create policy "shop_social_posts: insert own shop"
  on public.shop_social_posts for insert
  to authenticated
  with check (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or tech_id = public.shop_current_tech_id()
    )
  );

drop policy if exists "shop_social_posts: update own shop" on public.shop_social_posts;
create policy "shop_social_posts: update own shop"
  on public.shop_social_posts for update
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or tech_id = public.shop_current_tech_id()
    )
  )
  with check (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or tech_id = public.shop_current_tech_id()
    )
  );

-- DELETE: staff only. Not a restriction anyone will feel — 'discarded' is the
-- reject button, and it leaves the shop able to see what the generator has
-- been producing rather than only what survived.
drop policy if exists "shop_social_posts: delete by staff" on public.shop_social_posts;
create policy "shop_social_posts: delete by staff"
  on public.shop_social_posts for delete
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and public.shop_is_staff()
  );


-- ============================================================
-- VERIFICATION, POST-APPLY
--
-- Table present, RLS on:
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' and tablename = 'shop_social_posts';
--
-- Four policies:
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'public' and tablename = 'shop_social_posts'
--    order by cmd;
--
-- Four indexes — the primary key plus the three above:
--   select indexname, indexdef from pg_indexes
--    where schemaname = 'public' and tablename = 'shop_social_posts'
--    order by indexname;
--
-- Both check constraints bite. Each of these must fail:
--   begin;
--   insert into public.shop_social_posts (shop_id, platform, content)
--     values ('<a real shop id>', 'threads', 'hi');
--   rollback;
--   begin;
--   insert into public.shop_social_posts (shop_id, platform, content, status)
--     values ('<a real shop id>', 'tiktok', 'hi', 'scheduled');
--   rollback;
--
-- A new row defaults to pending, not approved:
--   begin;
--   insert into public.shop_social_posts (shop_id, platform, content)
--     values ('<a real shop id>', 'tiktok', 'hi')
--     returning status;
--   rollback;
--
-- The updated_at trigger exists and moves the column:
--   select tgname from pg_trigger
--    where tgrelid = 'public.shop_social_posts'::regclass
--      and not tgisinternal;
--
-- With the anon key, [] or an error:
--   GET /rest/v1/shop_social_posts?select=id
-- ============================================================

-- ============================================================
-- END OF MIGRATION 012
-- ============================================================

-- ============================================================
-- NWI Shop
-- Migration: 006_shop_subscriptions.sql
-- Stripe subscription state, and the charter-slot counter the public
-- marketing page calls.
-- Run this entire file in your Supabase SQL Editor, after 005.
-- ============================================================


-- ============================================================
-- SHOP SUBSCRIPTIONS
-- One row per shop -- see the unique index. Stripe is the source of truth;
-- this table is the local mirror the app reads on every page load so that
-- gating a feature never costs a round trip to Stripe.
--
-- `tier` is mirrored onto shop_profiles.subscription_tier as well. That
-- duplication is intentional: the profile column is what the UI reads, this
-- column is what the webhook writes, and the webhook keeps the two in step.
--
-- Writes here come from the Stripe webhook over the SERVICE ROLE key, which
-- bypasses RLS entirely. The policies in 007 therefore exist to govern what a
-- logged-in human may do, not what the billing pipeline may do.
-- ============================================================
create table if not exists public.shop_subscriptions (
  id                     uuid        primary key default gen_random_uuid(),
  shop_id                uuid        not null references public.shop_profiles(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  tier                   text        not null default 'starter'
                                     check (tier in ('starter', 'pro', 'elite')),
  status                 text        not null default 'incomplete'
                                     check (status in ('active', 'past_due', 'canceled',
                                                       'incomplete', 'trialing')),
  -- Denormalised "may this shop use the product right now". Kept separate
  -- from `status` because the answer is a business decision over several
  -- statuses (a trialing or past-due shop may still be allowed in for a
  -- grace period) and every gate in the app should ask one boolean, not
  -- re-derive that decision in five places.
  active                 boolean     not null default false,
  -- The first 50 paying shops keep founding pricing for life. Counted by
  -- get_charter_slots_remaining() below.
  is_charter_member      boolean     not null default false,
  -- Paid add-on, separate from the tier. Elite only means "may purchase".
  foreman_ai             boolean     not null default false,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- One subscription row per shop. The webhook upserts on this; without the
-- constraint a replayed Stripe event would create a second row and the app
-- would start reading whichever one came back first.
create unique index if not exists idx_shop_subscriptions_shop_id_unique
  on public.shop_subscriptions(shop_id);

create index if not exists idx_shop_subscriptions_stripe_customer_id
  on public.shop_subscriptions(stripe_customer_id)
  where stripe_customer_id is not null;
create index if not exists idx_shop_subscriptions_stripe_subscription_id
  on public.shop_subscriptions(stripe_subscription_id)
  where stripe_subscription_id is not null;
-- Serves the charter counter below.
create index if not exists idx_shop_subscriptions_charter
  on public.shop_subscriptions(is_charter_member)
  where active and is_charter_member;

drop trigger if exists set_shop_subscriptions_updated_at on public.shop_subscriptions;
create trigger set_shop_subscriptions_updated_at
  before update on public.shop_subscriptions
  for each row execute procedure public.shop_set_updated_at();

alter table public.shop_subscriptions enable row level security;


-- ============================================================
-- CHARTER SLOTS REMAINING
--
-- The landing page shows "N of 50 charter seats left" to a visitor who has
-- not signed in and has no session at all. That page is served with the anon
-- key, so the count has to be reachable by the `anon` role.
--
-- SECURITY DEFINER is what makes that safe. The function runs as its owner,
-- so it can count rows in shop_subscriptions -- a table anon has no policy on
-- and can therefore not read a single row of -- and hands back nothing but an
-- integer. No shop name, no Stripe id, no tier, no row count of anything
-- except charter members, and no way to filter or probe: the function takes
-- no arguments.
--
-- STABLE, not IMMUTABLE: the answer changes as shops sign up.
-- SET search_path = public pins name resolution, so the function cannot be
-- tricked into reading some other `shop_subscriptions` planted earlier on a
-- caller's search_path.
--
-- greatest(0, ...) so an overshoot past 50 (a manual grant, a Stripe replay)
-- shows the page a calm zero rather than a negative number.
-- ============================================================
create or replace function public.get_charter_slots_remaining()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    0,
    50 - (
      select count(*)
        from public.shop_subscriptions s
       where s.active
         and s.is_charter_member
    )::int
  );
$$;

-- EXECUTE is granted to PUBLIC by default on new functions; revoke first so
-- the grants below are the whole of the access list, then hand it to exactly
-- the two roles that need it. `anon` is deliberate and is the point of the
-- function -- the marketing page calls it with no session.
revoke all on function public.get_charter_slots_remaining() from public;
grant execute on function public.get_charter_slots_remaining() to anon, authenticated;

comment on function public.get_charter_slots_remaining() is
  'Charter seats left out of 50. Callable by anon for the public landing page; returns only an integer and never exposes shop_subscriptions rows.';

-- ============================================================
-- END OF MIGRATION 006
-- ============================================================

-- ============================================================
-- NWI Shop
-- Migration: 001_shop_core.sql
-- Core tenant tables: shop_profiles, shop_techs
-- Run this entire file in your Supabase SQL Editor.
-- ============================================================
--
-- NOTE ON NAMING. These tables live in the SAME Supabase project as the
-- National Wrench Index mobile-mechanic app (public.profiles, public.jobs,
-- public.customers, ...). Every object created by the NWI Shop migrations is
-- therefore prefixed `shop_` — tables, functions, triggers, indexes and
-- policies — so nothing here can collide with, shadow or silently replace an
-- object that app depends on. In particular the updated_at trigger function is
-- `shop_set_updated_at()`, NOT the existing `public.set_updated_at()`.
--
-- RLS is enabled here so that the window between this file and 007 fails
-- CLOSED (RLS on with zero policies denies everything). The policies
-- themselves all live in 007_shop_rls.sql.
-- ============================================================


-- ============================================================
-- SHOP PROFILES
-- One row per shop. This row's id is the tenant key that every other
-- shop_* table carries as shop_id.
-- ============================================================
create table if not exists public.shop_profiles (
  id                uuid        primary key default gen_random_uuid(),
  -- The signing-up account. Kept separate from shop_techs: an owner is the
  -- shop's billing/legal contact and exists before any tech row does. The RLS
  -- helpers in 007 fall back to this column so a brand-new owner can see and
  -- populate their own shop before they have added themselves as a tech.
  owner_id          uuid        not null references auth.users(id) on delete cascade,
  business_name     text        not null,
  logo_url          text,
  address           text,
  city              text,
  state             text,
  zip               text,
  phone             text,
  email             text,
  -- Plain `numeric`, deliberately not numeric(p,s). tax_rate is stored as a
  -- fraction (0.0875 = 8.75%) and a scale-2 column would round it to 0.09.
  tax_rate          numeric     not null default 0,
  labor_rate        numeric     not null default 0,
  subscription_tier text        not null default 'starter'
                                check (subscription_tier in ('starter', 'pro', 'elite')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_shop_profiles_owner_id on public.shop_profiles(owner_id);


-- ============================================================
-- SHOP TECHS
-- Everyone who works in the shop, at any of the three roles.
-- user_id is NULL for a tech who has been entered on the roster but has not
-- yet claimed a login — the row is still schedulable and still clocks time.
-- ============================================================
create table if not exists public.shop_techs (
  id         uuid        primary key default gen_random_uuid(),
  shop_id    uuid        not null references public.shop_profiles(id) on delete cascade,
  user_id    uuid        references auth.users(id) on delete set null,
  first_name text        not null,
  last_name  text        not null,
  email      text,
  phone      text,
  role       text        not null check (role in ('manager', 'foreman', 'tech')),
  -- Hourly pay. Visible to managers only. See the note in 007 — RLS is
  -- row-level and cannot hide this COLUMN from a foreman who may read the row.
  pay_rate   numeric,
  hire_date  date,
  active     boolean     not null default true,
  created_at timestamptz not null default now()
);

-- One auth user maps to at most one tech row, project-wide. The RLS helper
-- shop_current_tech_id() resolves the caller through this column and must get
-- exactly one answer; without this index a duplicate row would make a user's
-- effective shop and role depend on scan order.
create unique index if not exists idx_shop_techs_user_id_unique
  on public.shop_techs(user_id)
  where user_id is not null;

create index if not exists idx_shop_techs_shop_id on public.shop_techs(shop_id);
create index if not exists idx_shop_techs_shop_active
  on public.shop_techs(shop_id)
  where active;


-- ============================================================
-- UPDATED_AT
-- shop_set_updated_at() — prefixed so it cannot clash with the existing
-- public.set_updated_at() used by the other app in this project.
-- ============================================================
create or replace function public.shop_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_shop_profiles_updated_at on public.shop_profiles;
create trigger set_shop_profiles_updated_at
  before update on public.shop_profiles
  for each row execute procedure public.shop_set_updated_at();


-- ============================================================
-- ROW LEVEL SECURITY — enabled here, policies in 007
-- ============================================================
alter table public.shop_profiles enable row level security;
alter table public.shop_techs    enable row level security;

-- ============================================================
-- END OF MIGRATION 001
-- ============================================================

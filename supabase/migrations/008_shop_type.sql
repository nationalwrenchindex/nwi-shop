-- ============================================================
-- NWI Shop
-- Migration: 008_shop_type.sql
-- Adds shop_profiles.shop_type — the light-duty / heavy-duty / full-service
-- discriminator that drives feature access and pricing.
-- Run this entire file in your Supabase SQL Editor.
-- ============================================================
--
-- This is an ALTER against a table that is already live and populated, not a
-- fresh create. 001 shipped shop_profiles without a type because every early
-- shop was light duty by definition; the column is added here with a default
-- so existing rows are correct the moment it lands rather than needing a
-- separate backfill pass.
--
-- NOT NULL is deliberate. `ShopProfile.shop_type` in lib/types.ts is declared
-- non-nullable, and a nullable column would make that type a lie — every read
-- path would have to defend against a value the type says cannot occur.
-- lib/auth.ts additionally coalesces a missing value to 'ld' (`shop.shop_type
-- ?? 'ld'`) as belt and braces, for the window where a client build is newer
-- than the database; that fallback is not a licence to leave the column
-- nullable here.
--
-- The three values are fixed by `ShopType` in lib/types.ts. Adding a fourth
-- means editing this constraint, `ShopType`, FEATURES_BY_TYPE and
-- TIER_PRICES_BY_TYPE together — the check constraint is what makes the
-- database refuse a value the application has no branch for.
-- ============================================================


-- ============================================================
-- SHOP TYPE COLUMN
-- ============================================================
alter table public.shop_profiles
  add column if not exists shop_type text not null default 'ld';

-- Guarded so the file can be re-run: `alter table ... add constraint` has no
-- `if not exists` form and errors on a duplicate constraint name.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'shop_profiles_shop_type_check'
       and conrelid = 'public.shop_profiles'::regclass
  ) then
    alter table public.shop_profiles
      add constraint shop_profiles_shop_type_check
      check (shop_type in ('ld', 'hd', 'full_service'));
  end if;
end;
$$;

comment on column public.shop_profiles.shop_type is
  'Light duty / heavy duty / full service. Drives which diagnostic tools the shop may open (FEATURES_BY_TYPE in lib/permissions.ts — QuickWrench LD, QuickWrench HD, reefer codes, trailer ABS, EPA 608, DOT inspections) and which price book its tier is billed from (TIER_PRICES_BY_TYPE). ld and hd share one price book; full_service is billed higher and on its own Stripe products.';

-- The landing and admin pages count shops by type ("how many HD shops signed
-- up this month"), which is a whole-table aggregate with no shop_id to narrow
-- it — the only access path that does not already ride an existing index.
create index if not exists idx_shop_profiles_shop_type
  on public.shop_profiles(shop_type);


-- ============================================================
-- ROW LEVEL SECURITY — NO CHANGE NEEDED
--
-- Deliberately empty. Postgres RLS is row-level: the four shop_profiles
-- policies in 007 ("select own shop", "insert own", "update by manager",
-- "delete by owner") gate whole rows on owner_id and shop_current_shop_id(),
-- and every column of a row a caller may read is already covered — including
-- ones added after the policy was written. shop_type needs no policy of its
-- own and this file adds none. Do not read the absence of policy statements
-- here as a gap someone forgot to close.
--
-- The one caveat is the mirror image of the pay_rate note in 007: RLS cannot
-- stop a shop member from reading this column either. That is fine — shop_type
-- is not a secret from the people who work at the shop.
--
-- Note also that shop_type is NOT part of any policy predicate. A shop that
-- changes type keeps exactly the same row visibility; feature gating is an
-- application-layer decision (lib/permissions.ts), not an RLS one.
-- ============================================================


-- ============================================================
-- SHOP SUBSCRIPTIONS — INTENTIONALLY UNTOUCHED
--
-- Shop type lives on the profile and nowhere else: the subscription row
-- already records what was actually sold (its Stripe subscription, and the
-- price book behind it), so a denormalised shop_type on shop_subscriptions
-- would be a second copy that can disagree with the first. Read it through
-- shop_profiles, one join away. Do not add it here later.
-- ============================================================


-- ============================================================
-- VERIFICATION, POST-APPLY
--
-- The column exists, is not null, and defaults to 'ld':
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name   = 'shop_profiles'
--      and column_name  = 'shop_type';
--
-- Every existing row was backfilled — expect ld = the row count you started
-- with (1 for the seeded NWI Demo Shop) and no null bucket at all:
--   select shop_type, count(*)
--     from public.shop_profiles
--    group by shop_type
--    order by shop_type;
--
-- The seeded shop specifically:
--   select id, business_name, shop_type, subscription_tier
--     from public.shop_profiles
--    where id = '106ae312-5ac6-470a-91a4-6f5799c44a92';
--
-- The constraint is present and names all three values:
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.shop_profiles'::regclass
--      and conname  = 'shop_profiles_shop_type_check';
--
-- And it bites — this must fail with a check-constraint violation, not
-- succeed (roll it back either way):
--   begin;
--   update public.shop_profiles set shop_type = 'medium_duty';
--   rollback;
--
-- The index is there:
--   select indexname, indexdef from pg_indexes
--    where schemaname = 'public'
--      and tablename  = 'shop_profiles'
--      and indexname  = 'idx_shop_profiles_shop_type';
--
-- Policy count on shop_profiles is unchanged at 4 — this file adds none:
--   select count(*) from pg_policies
--    where schemaname = 'public' and tablename = 'shop_profiles';
-- ============================================================

-- ============================================================
-- END OF MIGRATION 008
-- ============================================================

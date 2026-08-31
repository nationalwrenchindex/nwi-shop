-- ============================================================
-- NWI Shop
-- Migration: 004_shop_timeclock.sql
-- Shop clock and job clock punches.
-- Run this entire file in your Supabase SQL Editor, after 003.
-- ============================================================
--
-- One table, two kinds of punch, distinguished by `type`:
--
--   type = 'shop'  job_id IS NULL      -- on the clock, in the building
--   type = 'job'   job_id references a work order -- turning wrenches on it
--
-- They are deliberately not two tables. A tech is normally shop-punched AND
-- job-punched at the same time, payroll reads the shop punches, and job
-- costing reads the job punches; keeping them in one table means the punch UI,
-- the open-punch lookup and the correction flow are all written once.
-- ============================================================

create table if not exists public.shop_timeclock (
  id            uuid        primary key default gen_random_uuid(),
  shop_id       uuid        not null references public.shop_profiles(id) on delete cascade,
  -- CASCADE, not SET NULL: a punch with no tech is not a payroll record, it is
  -- an orphan. Deleting a tech is already the rare, deliberate act -- the
  -- normal way to remove someone from the floor is shop_techs.active = false,
  -- which leaves every punch they ever made intact.
  tech_id       uuid        not null references public.shop_techs(id) on delete cascade,
  -- NULL means this is a shop punch rather than a job punch. SET NULL on job
  -- delete: the hours were still worked and still have to be paid.
  job_id        uuid        references public.shop_jobs(id) on delete set null,
  type          text        not null check (type in ('shop', 'job')),
  punch_in      timestamptz not null,
  -- NULL punch_out is the definition of an open punch -- see the unique index.
  punch_out     timestamptz,
  -- Written when the punch is closed. Stored rather than computed so a
  -- manager's correction to a shift survives as an auditable number.
  total_minutes integer,
  notes         text,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- AT MOST ONE OPEN PUNCH PER TECH PER TYPE
--
-- This is the integrity rule the whole timeclock rests on, and it belongs in
-- the database rather than in a check-then-insert in application code, where
-- a double-tap on a phone or a retried request races through the gap between
-- the check and the insert.
--
-- Partial on `punch_out is null` so only OPEN punches participate: a tech may
-- have ten thousand closed job punches in their history and exactly one open
-- one. The two rows it permits simultaneously are one 'shop' and one 'job',
-- which is the normal working state.
--
--   'job'  -- a tech cannot be turning wrenches on two work orders at once,
--             so job costing can never double-bill the same minute.
--   'shop' -- a tech cannot be shop-punched-in twice, so payroll can never
--             pay the same hour twice.
--
-- Closing a punch (setting punch_out) frees the slot for the next one.
-- ------------------------------------------------------------
create unique index if not exists idx_shop_timeclock_one_open_punch
  on public.shop_timeclock(tech_id, type)
  where punch_out is null;

create index if not exists idx_shop_timeclock_shop_id on public.shop_timeclock(shop_id);
create index if not exists idx_shop_timeclock_job_id  on public.shop_timeclock(job_id);
-- "Who is on the clock right now" and "this tech's open punch", the two reads
-- the punch screen makes on every load.
create index if not exists idx_shop_timeclock_tech_punch_out
  on public.shop_timeclock(tech_id, punch_out);
-- Payroll and job-costing period scans.
create index if not exists idx_shop_timeclock_shop_punch_in
  on public.shop_timeclock(shop_id, punch_in);


-- ============================================================
-- ROW LEVEL SECURITY -- enabled here, policies in 007
-- ============================================================
alter table public.shop_timeclock enable row level security;

-- ============================================================
-- END OF MIGRATION 004
-- ============================================================

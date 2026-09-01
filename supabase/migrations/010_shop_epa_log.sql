-- ============================================================
-- NWI Shop
-- Migration: 010_shop_epa_log.sql
-- shop_epa_log — the EPA Section 608 refrigerant log.
-- Run this entire file in your Supabase SQL Editor, after 009.
-- ============================================================
--
-- WHAT THIS TABLE IS FOR
--
-- 40 CFR Part 82 requires a technician who opens a refrigerant circuit to
-- record what they did with the refrigerant: how much went in, how much came
-- out, how much was evacuated, and who — by certification number — did it.
-- The log is the shop's answer when an inspector asks. It is not an
-- operational table; nothing in the app reads it to decide anything. It is
-- written once per event and read in bulk, by date range, at audit time.
--
-- That shape is why every column here is a snapshot rather than a join:
-- refrigerant_type, pounds and tech_certification_number are recorded as they
-- were on the day, and the FKs beside them are conveniences that may go null.
--
-- `pounds` is plain numeric, not numeric(p,s), for the same reason
-- shop_profiles.tax_rate is in 001: a fixed scale would round. Recovery
-- amounts are read off a scale to two or three decimals and the log has to
-- record what the scale said, not a rounded version of it.
-- ============================================================


-- ============================================================
-- SHOP EPA LOG
-- ============================================================
create table if not exists public.shop_epa_log (
  id                        uuid        primary key default gen_random_uuid(),
  shop_id                   uuid        not null references public.shop_profiles(id) on delete cascade,

  -- SET NULL, not CASCADE — the same rule as shop_inspections in 009 and for
  -- the same reason. A refrigerant entry is a regulatory record: voiding the
  -- work order it was logged against, or deleting the vehicle, must not erase
  -- the fact that four pounds of R-134a were recovered on a Tuesday.
  job_id                    uuid        references public.shop_jobs(id)     on delete set null,
  vehicle_id                uuid        references public.shop_vehicles(id) on delete set null,
  tech_id                   uuid        references public.shop_techs(id)    on delete set null,

  -- A date, not a timestamptz. The regulation asks what day the work was
  -- done, the paper log has a date column, and the entry is routinely typed in
  -- after the fact — a timestamp would invite the app to record when somebody
  -- reached the keyboard and call that the event.
  log_date                  date        not null default current_date,

  -- Free text, not an enum. The refrigerant list is not ours: R-134a, R-1234yf
  -- and R-404A are the common ones today, the list changes by regulation and
  -- by what the supplier will sell, and a check constraint here would mean a
  -- migration every time a shop stocks something new.
  refrigerant_type          text        not null,

  -- This one IS constrained, because these four are the only things the
  -- regulation recognises and the reporting totals branch on all four.
  action                    text        not null
                                        check (action in ('added', 'recovered',
                                                          'evacuated', 'leak_test')),

  -- Unsigned by convention: `action` carries the direction, so the sign lives
  -- in one place. A leak_test row is normally 0.
  pounds                    numeric     not null,

  reason                    text,

  -- The certifying technician's EPA 608 number, copied onto the row rather
  -- than read through tech_id. The number belongs to the person, the person
  -- can leave the shop, and the log still has to name a certified individual.
  -- shop_profiles.epa_cert_number (added in 015) is the shop-level default the
  -- form pre-fills from.
  tech_certification_number text,

  notes                     text,
  created_at                timestamptz not null default now()
);

create index if not exists idx_shop_epa_log_shop_id
  on public.shop_epa_log(shop_id);

-- The audit query, and effectively the only read path: one shop, one date
-- range, newest first.
create index if not exists idx_shop_epa_log_shop_date
  on public.shop_epa_log(shop_id, log_date desc);

create index if not exists idx_shop_epa_log_job_id
  on public.shop_epa_log(job_id)
  where job_id is not null;

create index if not exists idx_shop_epa_log_vehicle_id
  on public.shop_epa_log(vehicle_id)
  where vehicle_id is not null;

-- Serves the tech-scoped write policies below, and "what did I log this year".
create index if not exists idx_shop_epa_log_tech_id
  on public.shop_epa_log(tech_id)
  where tech_id is not null;

comment on table public.shop_epa_log is
  'EPA Section 608 refrigerant log, one row per event. Job, vehicle and tech links are ON DELETE SET NULL because the entry is a regulatory record that outlives all three; refrigerant_type, pounds and tech_certification_number are snapshots of the day, not joins.';


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.shop_epa_log enable row level security;

grant select, insert, update, delete on public.shop_epa_log to authenticated;
revoke all on public.shop_epa_log from anon;

-- READ: the whole shop. The log is a shop-level compliance document — a
-- manager runs the annual total, and a tech has to be able to see the previous
-- entries on a unit before adding the next one.
drop policy if exists "shop_epa_log: select own shop" on public.shop_epa_log;
create policy "shop_epa_log: select own shop"
  on public.shop_epa_log for select
  to authenticated
  using (shop_id = public.shop_current_shop_id());

-- WRITE: staff anywhere in their shop; a tech only under their own tech_id,
-- and only against a job they can already see. Logging refrigerant is part of
-- doing the work, so unlike shop_inventory_transactions in 007 this is a write
-- a tech genuinely needs from their own session.
--
-- shop_job_visible(job_id) rather than an inline assigned_tech_id test, so the
-- rule tracks the job board exactly. `job_id is null or ...` because topping
-- up a shop cylinder is a logged event with no work order behind it.
drop policy if exists "shop_epa_log: insert own shop" on public.shop_epa_log;
create policy "shop_epa_log: insert own shop"
  on public.shop_epa_log for insert
  to authenticated
  with check (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or (
        tech_id = public.shop_current_tech_id()
        and (job_id is null or public.shop_job_visible(job_id))
      )
    )
  );

drop policy if exists "shop_epa_log: update own shop" on public.shop_epa_log;
create policy "shop_epa_log: update own shop"
  on public.shop_epa_log for update
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or (
        tech_id = public.shop_current_tech_id()
        and (job_id is null or public.shop_job_visible(job_id))
      )
    )
  )
  with check (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or (
        tech_id = public.shop_current_tech_id()
        and (job_id is null or public.shop_job_visible(job_id))
      )
    )
  );

-- DELETE: staff only, narrower than the write rule, same reasoning as
-- shop_inspections in 009. The person who logged a discrepancy is not the
-- person who should be able to remove it from the log.
drop policy if exists "shop_epa_log: delete by staff" on public.shop_epa_log;
create policy "shop_epa_log: delete by staff"
  on public.shop_epa_log for delete
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
--    where schemaname = 'public' and tablename = 'shop_epa_log';
--
-- Four policies:
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'public' and tablename = 'shop_epa_log'
--    order by cmd;
--
-- Six indexes — the primary key plus the five above:
--   select indexname, indexdef from pg_indexes
--    where schemaname = 'public' and tablename = 'shop_epa_log'
--    order by indexname;
--
-- The action constraint bites. This must fail, not succeed:
--   begin;
--   insert into public.shop_epa_log
--     (shop_id, refrigerant_type, action, pounds)
--     values ('<a real shop id>', 'R-134a', 'topped_off', 1);
--   rollback;
--
-- All three FKs are SET NULL (confdeltype = 'n'):
--   select conname, confdeltype
--     from pg_constraint
--    where conrelid = 'public.shop_epa_log'::regclass
--      and contype  = 'f'
--    order by conname;
--
-- pounds keeps its precision — this must come back 2.375, not 2.38:
--   begin;
--   insert into public.shop_epa_log
--     (shop_id, refrigerant_type, action, pounds)
--     values ('<a real shop id>', 'R-134a', 'recovered', 2.375)
--     returning pounds;
--   rollback;
--
-- With the anon key, [] or an error, never a row:
--   GET /rest/v1/shop_epa_log?select=id
-- ============================================================

-- ============================================================
-- END OF MIGRATION 010
-- ============================================================

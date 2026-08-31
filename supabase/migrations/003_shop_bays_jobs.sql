-- ============================================================
-- NWI Shop
-- Migration: 003_shop_bays_jobs.sql
-- Bays, jobs (work orders), and job line items.
-- Run this entire file in your Supabase SQL Editor, after 002.
-- ============================================================
--
-- ORDER MATTERS INSIDE THIS FILE. shop_bays and shop_jobs reference each
-- other: a job knows the bay it is sitting in, and a bay knows the job
-- currently occupying it. That cycle is broken by creating shop_bays first
-- WITHOUT the current_job_id constraint, creating shop_jobs (which can then
-- reference bays inline), and adding the back-reference by ALTER at the end.
-- ============================================================


-- ============================================================
-- SHOP BAYS
-- The physical stalls on the floor. current_job_id is denormalised on
-- purpose: the bay board is the single most-refreshed screen in the app and
-- it should not have to scan shop_jobs to paint itself.
-- ============================================================
create table if not exists public.shop_bays (
  id             uuid        primary key default gen_random_uuid(),
  shop_id        uuid        not null references public.shop_profiles(id) on delete cascade,
  label          text        not null,
  type           text        not null check (type in ('lift', 'flat', 'alignment', 'other')),
  status         text        not null default 'available'
                             check (status in ('available', 'occupied', 'out_of_service')),
  -- FK added at the bottom of this file, once shop_jobs exists.
  current_job_id uuid,
  sort_order     integer     not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists idx_shop_bays_shop_id on public.shop_bays(shop_id);
-- The bay board reads in display order within one shop.
create index if not exists idx_shop_bays_shop_sort on public.shop_bays(shop_id, sort_order);


-- ============================================================
-- SHOP JOBS
-- The work order. Every optional reference is ON DELETE SET NULL rather than
-- CASCADE: deleting a bay, a tech or a customer must never delete the history
-- of the work that was done. shop_id is the only CASCADE -- deleting the shop
-- deletes the shop.
--
-- `voided` rather than a hard delete: an invoiced job is a financial record.
-- ============================================================
create table if not exists public.shop_jobs (
  id               uuid        primary key default gen_random_uuid(),
  shop_id          uuid        not null references public.shop_profiles(id) on delete cascade,
  customer_id      uuid        references public.shop_customers(id) on delete set null,
  vehicle_id       uuid        references public.shop_vehicles(id)  on delete set null,
  bay_id           uuid        references public.shop_bays(id)      on delete set null,
  assigned_tech_id uuid        references public.shop_techs(id)     on delete set null,
  -- Assigned by the BEFORE INSERT trigger below. NOT NULL is safe even though
  -- callers never supply it: row triggers fire before constraints are checked.
  job_number       integer     not null,
  status           text        not null default 'estimate'
                               check (status in ('estimate', 'approved', 'in_progress',
                                                 'completed', 'invoiced')),
  description      text,
  complaint        text,
  notes            text,
  estimated_hours  numeric,
  bay_assigned_at  timestamptz,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  invoiced_at      timestamptz,
  voided           boolean     not null default false
);

-- Job numbers are per shop and start at 1 in every shop. Shop A's job 42 and
-- shop B's job 42 are different jobs; this is the constraint that says so, and
-- it is also the last line of defence for the numbering trigger below.
create unique index if not exists idx_shop_jobs_shop_job_number
  on public.shop_jobs(shop_id, job_number);

create index if not exists idx_shop_jobs_shop_id     on public.shop_jobs(shop_id);
create index if not exists idx_shop_jobs_customer_id on public.shop_jobs(customer_id);
create index if not exists idx_shop_jobs_vehicle_id  on public.shop_jobs(vehicle_id);
create index if not exists idx_shop_jobs_bay_id      on public.shop_jobs(bay_id);
create index if not exists idx_shop_jobs_status      on public.shop_jobs(status);
-- The job board: open work in one shop, the hottest query in the app.
create index if not exists idx_shop_jobs_shop_status on public.shop_jobs(shop_id, status);
-- A tech's own board. Partial, because most rows in a busy shop's history are
-- closed and nobody's dashboard ever asks for them.
create index if not exists idx_shop_jobs_assigned_tech
  on public.shop_jobs(assigned_tech_id, status)
  where assigned_tech_id is not null and not voided;


-- ------------------------------------------------------------
-- PER-SHOP JOB NUMBERING
--
-- max(job_number) + 1 scoped to the inserting row's shop_id.
--
-- A plain sequence cannot do this: one sequence would number every shop off
-- the same counter, so a brand-new shop's first job would come out as #1847.
-- A sequence per shop would mean issuing DDL from application code at signup.
-- max+1 in a trigger is the right shape here -- a shop writes a handful of
-- jobs a day, not a thousand a second.
--
-- The advisory lock is what makes it correct under concurrency. Two writers
-- inserting into the SAME shop in overlapping transactions would otherwise
-- both read the same max and both compute the same next number; one would then
-- fail on the unique index above. The lock serialises on shop_id only, is
-- transaction-scoped (released at commit or rollback, so there is no leak
-- path), and never blocks an insert into a different shop.
--
-- An explicitly supplied job_number is honoured, so a data import can carry a
-- shop's existing numbering across.
-- ------------------------------------------------------------
create or replace function public.shop_assign_job_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.job_number is not null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.shop_id::text, 0));

  select coalesce(max(j.job_number), 0) + 1
    into new.job_number
    from public.shop_jobs j
   where j.shop_id = new.shop_id;

  return new;
end;
$$;

drop trigger if exists set_shop_jobs_job_number on public.shop_jobs;
create trigger set_shop_jobs_job_number
  before insert on public.shop_jobs
  for each row execute procedure public.shop_assign_job_number();


-- ------------------------------------------------------------
-- BAY BACK-REFERENCE
-- Deferred to here because shop_jobs did not exist when shop_bays was
-- created. SET NULL: closing out a job empties the bay, it does not delete it.
-- ------------------------------------------------------------
alter table public.shop_bays
  drop constraint if exists shop_bays_current_job_id_fkey;
alter table public.shop_bays
  add constraint shop_bays_current_job_id_fkey
  foreign key (current_job_id) references public.shop_jobs(id) on delete set null;

create index if not exists idx_shop_bays_current_job_id
  on public.shop_bays(current_job_id)
  where current_job_id is not null;


-- ============================================================
-- SHOP JOB LINE ITEMS
-- Labour and parts on a work order. Carries shop_id as well as job_id so RLS
-- and the shop-wide financial reports never need the join.
--
-- unit_cost is what the shop paid; unit_price is what the customer pays. The
-- gap between them is the margin a foreman is not allowed to see -- that is an
-- application-layer rule (lib/permissions.ts, viewMargins), not an RLS one.
-- ============================================================
create table if not exists public.shop_job_line_items (
  id           uuid        primary key default gen_random_uuid(),
  job_id       uuid        not null references public.shop_jobs(id)      on delete cascade,
  shop_id      uuid        not null references public.shop_profiles(id)  on delete cascade,
  type         text        not null check (type in ('labor', 'part')),
  description  text        not null,
  part_number  text,
  quantity     numeric     not null default 1,
  tech_id      uuid        references public.shop_techs(id) on delete set null,
  unit_cost    numeric     not null default 0,
  unit_price   numeric     not null default 0,
  total        numeric     not null default 0,
  -- The FK to public.shop_inventory is added in 005, which is where that
  -- table is created. The column exists from here so 003 and 005 can be
  -- applied in order without a rewrite.
  inventory_id uuid,
  created_at   timestamptz not null default now()
);

create index if not exists idx_shop_job_line_items_job_id  on public.shop_job_line_items(job_id);
create index if not exists idx_shop_job_line_items_shop_id on public.shop_job_line_items(shop_id);
create index if not exists idx_shop_job_line_items_tech_id on public.shop_job_line_items(tech_id);


-- ============================================================
-- ROW LEVEL SECURITY -- enabled here, policies in 007
-- ============================================================
alter table public.shop_bays           enable row level security;
alter table public.shop_jobs           enable row level security;
alter table public.shop_job_line_items enable row level security;

-- ============================================================
-- END OF MIGRATION 003
-- ============================================================

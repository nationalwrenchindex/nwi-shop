-- ============================================================
-- NWI Shop
-- Migration: 007_shop_rls.sql
-- RLS helper functions, the shop_techs_safe view, table grants, and every
-- policy in the schema.
-- Run this entire file in your Supabase SQL Editor, after 006.
-- ============================================================
--
-- THE SECURITY MODEL, IN ONE PARAGRAPH
--
-- shop_id is the tenant boundary and it is absolute: every policy below, on
-- every table, begins with `shop_id = shop_current_shop_id()`. Nothing crosses
-- between shops, in either direction, for any role. Inside a shop, role
-- narrows things further -- a tech sees the jobs assigned to them and the
-- punches they made, and nothing else that is personal to a colleague.
--
-- WHY THE HELPERS ARE SECURITY DEFINER
--
-- The policy on shop_techs has to know the caller's role, which means reading
-- shop_techs, which would re-enter the policy on shop_techs. Postgres detects
-- that and raises `infinite recursion detected in policy for relation
-- "shop_techs"`, and the whole table becomes unreadable. Wrapping the lookup
-- in a SECURITY DEFINER function breaks the loop: the function body runs as
-- its owner, which is not subject to those policies, so the recursion never
-- starts. Each is also STABLE (one evaluation per statement instead of one
-- per row) and pins `set search_path = public`, so a caller cannot shadow
-- `shop_techs` with their own table and talk the helper into trusting it.
--
-- These functions take no arguments and expose no rows -- only the caller's
-- own id, shop and role, all of which the caller already knows.
-- ============================================================


-- ============================================================
-- HELPERS
-- ============================================================

-- ------------------------------------------------------------
-- The caller's row in shop_techs, or NULL if they have none.
--
-- `active` is part of the lookup: deactivating a tech is how a shop removes
-- someone from the floor, and it has to take their access with it. A
-- deactivated tech resolves to NULL here, and `assigned_tech_id = NULL` is
-- NULL, which is not true, so every tech-scoped policy below closes rather
-- than opens. Deactivation is a lock-out, not a cosmetic flag.
-- ------------------------------------------------------------
create or replace function public.shop_current_tech_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.id
    from public.shop_techs t
   where t.user_id = auth.uid()
     and t.active
   limit 1;
$$;

-- ------------------------------------------------------------
-- The caller's shop.
--
-- The owner fallback is not a convenience, it is the bootstrap. A shop is
-- created by someone who has just signed up: at that instant there is a row
-- in shop_profiles with their owner_id and there is no row in shop_techs at
-- all, because adding staff is the step after. Without the second branch that
-- owner would resolve to NULL, be unable to read back the shop they just
-- created, and be unable to insert their own tech row into it -- signup would
-- dead-end on its second screen. Resolving them through shop_profiles.owner_id
-- means the owner always has a shop.
--
-- The tech row wins when both exist, so an owner who has added themselves to
-- the roster is governed by that row like anyone else.
-- ------------------------------------------------------------
create or replace function public.shop_current_shop_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select t.shop_id
       from public.shop_techs t
      where t.user_id = auth.uid()
        and t.active
      limit 1),
    (select p.id
       from public.shop_profiles p
      where p.owner_id = auth.uid()
      order by p.created_at
      limit 1)
  );
$$;

-- ------------------------------------------------------------
-- The caller's role: 'manager', 'foreman', 'tech', or NULL for someone with
-- no standing in any shop. An owner with no tech row is a manager of their
-- own shop -- the same bootstrap case as above, and the reason the fallback
-- is 'manager' rather than 'tech'.
-- ------------------------------------------------------------
create or replace function public.shop_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select t.role
       from public.shop_techs t
      where t.user_id = auth.uid()
        and t.active
      limit 1),
    (select 'manager'::text
       from public.shop_profiles p
      where p.owner_id = auth.uid()
      limit 1)
  );
$$;

-- ------------------------------------------------------------
-- Staff = manager or foreman. This mirrors lib/permissions.ts, where manager
-- and foreman share manageBays / manageTechs / manageInventory /
-- manageCustomers and differ only on the money questions (viewPayRates,
-- viewMargins, viewFinancials, runPayroll, manageBilling) -- which are
-- column-level and cannot be expressed as row policies. See the note on
-- shop_techs_safe below.
--
-- coalesce so a caller with no shop gets false rather than NULL.
-- ------------------------------------------------------------
create or replace function public.shop_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.shop_current_role() in ('manager', 'foreman'), false);
$$;

-- ------------------------------------------------------------
-- May the caller see this job? Used by the line-item policies, which have to
-- ask the same question shop_jobs already answers. Kept as a function so the
-- rule lives in exactly one place: change who can see a job and the line
-- items follow automatically.
-- ------------------------------------------------------------
create or replace function public.shop_job_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.shop_jobs j
     where j.id = p_job_id
       and j.shop_id = public.shop_current_shop_id()
       and (public.shop_is_staff() or j.assigned_tech_id = public.shop_current_tech_id())
  );
$$;

revoke all on function public.shop_current_tech_id()   from public;
revoke all on function public.shop_current_shop_id()   from public;
revoke all on function public.shop_current_role()      from public;
revoke all on function public.shop_is_staff()          from public;
revoke all on function public.shop_job_visible(uuid)   from public;

grant execute on function public.shop_current_tech_id()  to authenticated;
grant execute on function public.shop_current_shop_id()  to authenticated;
grant execute on function public.shop_current_role()     to authenticated;
grant execute on function public.shop_is_staff()         to authenticated;
grant execute on function public.shop_job_visible(uuid)  to authenticated;


-- ============================================================
-- PAY RATE: WHAT RLS DOES NOT DO
--
-- READ THIS BEFORE ASSUMING pay_rate IS PROTECTED BY THE DATABASE.
--
-- Postgres row level security is ROW level. It decides whether a caller may
-- see a row; it has no mechanism for hiding one COLUMN of a row the caller is
-- otherwise allowed to read. A foreman must be able to read shop_techs -- they
-- run the floor, assign jobs and manage the roster (lib/permissions.ts:
-- FOREMAN.manageTechs = true) -- and the moment a policy lets them read the
-- row, RLS has let them read pay_rate along with it. There is no policy that
-- can be written here to change that.
--
-- So pay-rate concealment from foremen is NOT enforced by RLS. It is enforced
-- in two other places, and only in those two:
--
--   1. lib/permissions.ts -- viewPayRates is false for foreman and tech, and
--      application code selects columns and renders UI accordingly.
--   2. public.shop_techs_safe (below) -- a view over shop_techs with pay_rate
--      omitted, for every read path that does not need it. Reading through the
--      view instead of the table is what makes rule 1 hard to forget.
--
-- The honest statement of the guarantee: a foreman who bypasses the app and
-- queries public.shop_techs directly with their own session token CAN read
-- pay_rate for their shop. If that has to become a real boundary, the fix is a
-- column-level GRANT (revoke select (pay_rate) from a foreman-specific
-- database role) or moving pay_rate to its own manager-only table -- not
-- another policy on this one. Nothing below pretends otherwise.
-- ============================================================

drop view if exists public.shop_techs_safe;

-- security_invoker = true is load-bearing. Without it the view executes as its
-- OWNER, which bypasses RLS on shop_techs entirely -- and this view would then
-- hand every authenticated caller the roster of every shop in the system. With
-- it, the view is just a column filter and the caller's own policies still
-- decide which rows come back.
create view public.shop_techs_safe
with (security_invoker = true)
as
  select
    t.id,
    t.shop_id,
    t.user_id,
    t.first_name,
    t.last_name,
    t.email,
    t.phone,
    t.role,
    t.hire_date,
    t.active,
    t.created_at
  from public.shop_techs t;

comment on view public.shop_techs_safe is
  'shop_techs without pay_rate. security_invoker, so the shop_techs policies still apply. Pay-rate concealment for foremen is an application-layer rule (lib/permissions.ts) plus this view, because RLS is row-level and cannot hide a column.';

grant select on public.shop_techs_safe to authenticated;


-- ============================================================
-- TABLE GRANTS
--
-- RLS filters rows; a GRANT decides whether the role may issue the statement
-- at all. Both are required. Nothing is granted to `anon`: the only thing an
-- unauthenticated visitor may call in this schema is
-- get_charter_slots_remaining(), and it returns an integer.
-- ============================================================
grant select, insert, update, delete on public.shop_profiles              to authenticated;
grant select, insert, update, delete on public.shop_techs                 to authenticated;
grant select, insert, update, delete on public.shop_customers             to authenticated;
grant select, insert, update, delete on public.shop_vehicles              to authenticated;
grant select, insert, update, delete on public.shop_bays                  to authenticated;
grant select, insert, update, delete on public.shop_jobs                  to authenticated;
grant select, insert, update, delete on public.shop_job_line_items        to authenticated;
grant select, insert, update, delete on public.shop_timeclock             to authenticated;
grant select, insert, update, delete on public.shop_inventory             to authenticated;
grant select, insert, update, delete on public.shop_inventory_transactions to authenticated;
grant select, insert, update, delete on public.shop_subscriptions         to authenticated;

revoke all on public.shop_profiles              from anon;
revoke all on public.shop_techs                 from anon;
revoke all on public.shop_customers             from anon;
revoke all on public.shop_vehicles              from anon;
revoke all on public.shop_bays                  from anon;
revoke all on public.shop_jobs                  from anon;
revoke all on public.shop_job_line_items        from anon;
revoke all on public.shop_timeclock             from anon;
revoke all on public.shop_inventory             from anon;
revoke all on public.shop_inventory_transactions from anon;
revoke all on public.shop_subscriptions         from anon;


-- ============================================================
-- ENABLE RLS
-- Repeated from 001-006 so this file is self-sufficient. Enabling twice is a
-- no-op; enabling once too few is a data breach.
-- ============================================================
alter table public.shop_profiles               enable row level security;
alter table public.shop_techs                  enable row level security;
alter table public.shop_customers              enable row level security;
alter table public.shop_vehicles               enable row level security;
alter table public.shop_bays                   enable row level security;
alter table public.shop_jobs                   enable row level security;
alter table public.shop_job_line_items         enable row level security;
alter table public.shop_timeclock              enable row level security;
alter table public.shop_inventory              enable row level security;
alter table public.shop_inventory_transactions enable row level security;
alter table public.shop_subscriptions          enable row level security;


-- ============================================================
-- SHOP PROFILES
-- Anyone in the shop may read it (the letterhead, the tax rate and the labour
-- rate are needed to price a job). Only a manager may change it.
-- ============================================================
drop policy if exists "shop_profiles: select own shop" on public.shop_profiles;
create policy "shop_profiles: select own shop"
  on public.shop_profiles for select
  to authenticated
  using (
    owner_id = auth.uid()
    or id = public.shop_current_shop_id()
  );

-- Signup. The row must name its creator as owner, so a new shop can only ever
-- be created under the caller's own account.
drop policy if exists "shop_profiles: insert own" on public.shop_profiles;
create policy "shop_profiles: insert own"
  on public.shop_profiles for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "shop_profiles: update by manager" on public.shop_profiles;
create policy "shop_profiles: update by manager"
  on public.shop_profiles for update
  to authenticated
  using (
    owner_id = auth.uid()
    or (id = public.shop_current_shop_id() and public.shop_current_role() = 'manager')
  )
  with check (
    owner_id = auth.uid()
    or (id = public.shop_current_shop_id() and public.shop_current_role() = 'manager')
  );

-- Deleting the shop cascades to every table in this schema, so it stays with
-- the account that owns the subscription and no one else.
drop policy if exists "shop_profiles: delete by owner" on public.shop_profiles;
create policy "shop_profiles: delete by owner"
  on public.shop_profiles for delete
  to authenticated
  using (owner_id = auth.uid());


-- ============================================================
-- SHOP TECHS
-- Staff (manager, foreman) see and manage the whole roster -- both have
-- manageTechs in lib/permissions.ts. A tech sees exactly one row: their own.
-- Column caveat on pay_rate: see the block above.
-- ============================================================
drop policy if exists "shop_techs: select own shop" on public.shop_techs;
create policy "shop_techs: select own shop"
  on public.shop_techs for select
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and (public.shop_is_staff() or id = public.shop_current_tech_id())
  );

drop policy if exists "shop_techs: insert by staff" on public.shop_techs;
create policy "shop_techs: insert by staff"
  on public.shop_techs for insert
  to authenticated
  with check (
    shop_id = public.shop_current_shop_id()
    and public.shop_is_staff()
  );

-- The WITH CHECK repeats the shop_id test so a staff member cannot move a tech
-- out of their shop and into someone else's by updating shop_id. USING governs
-- the row as it was; WITH CHECK governs the row as it will be, and a policy
-- that omits the second is a policy with a hole in it.
drop policy if exists "shop_techs: update by staff" on public.shop_techs;
create policy "shop_techs: update by staff"
  on public.shop_techs for update
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and public.shop_is_staff()
  )
  with check (
    shop_id = public.shop_current_shop_id()
    and public.shop_is_staff()
  );

drop policy if exists "shop_techs: delete by staff" on public.shop_techs;
create policy "shop_techs: delete by staff"
  on public.shop_techs for delete
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and public.shop_is_staff()
  );


-- ============================================================
-- SHOP CUSTOMERS
-- Everyone in the shop reads them -- a tech has to know whose truck is on the
-- lift. Staff write them (manageCustomers).
-- ============================================================
drop policy if exists "shop_customers: select own shop" on public.shop_customers;
create policy "shop_customers: select own shop"
  on public.shop_customers for select
  to authenticated
  using (shop_id = public.shop_current_shop_id());

drop policy if exists "shop_customers: insert by staff" on public.shop_customers;
create policy "shop_customers: insert by staff"
  on public.shop_customers for insert
  to authenticated
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_customers: update by staff" on public.shop_customers;
create policy "shop_customers: update by staff"
  on public.shop_customers for update
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff())
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_customers: delete by staff" on public.shop_customers;
create policy "shop_customers: delete by staff"
  on public.shop_customers for delete
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff());


-- ============================================================
-- SHOP VEHICLES
-- Same shape as customers: shop-wide read, staff write.
-- ============================================================
drop policy if exists "shop_vehicles: select own shop" on public.shop_vehicles;
create policy "shop_vehicles: select own shop"
  on public.shop_vehicles for select
  to authenticated
  using (shop_id = public.shop_current_shop_id());

drop policy if exists "shop_vehicles: insert by staff" on public.shop_vehicles;
create policy "shop_vehicles: insert by staff"
  on public.shop_vehicles for insert
  to authenticated
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_vehicles: update by staff" on public.shop_vehicles;
create policy "shop_vehicles: update by staff"
  on public.shop_vehicles for update
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff())
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_vehicles: delete by staff" on public.shop_vehicles;
create policy "shop_vehicles: delete by staff"
  on public.shop_vehicles for delete
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff());


-- ============================================================
-- SHOP BAYS
-- The bay board is visible to the whole shop -- a tech needs to know where to
-- push the truck. Only staff move bays around (manageBays).
-- ============================================================
drop policy if exists "shop_bays: select own shop" on public.shop_bays;
create policy "shop_bays: select own shop"
  on public.shop_bays for select
  to authenticated
  using (shop_id = public.shop_current_shop_id());

drop policy if exists "shop_bays: insert by staff" on public.shop_bays;
create policy "shop_bays: insert by staff"
  on public.shop_bays for insert
  to authenticated
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_bays: update by staff" on public.shop_bays;
create policy "shop_bays: update by staff"
  on public.shop_bays for update
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff())
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_bays: delete by staff" on public.shop_bays;
create policy "shop_bays: delete by staff"
  on public.shop_bays for delete
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff());


-- ============================================================
-- SHOP JOBS
-- The one place where role really changes what exists.
--
-- Staff see the whole board (viewAllJobs = true for manager and foreman). A
-- tech sees only the jobs assigned to them -- viewAllJobs = false -- and that
-- is enforced here, not just in the UI, so a hand-written request against the
-- REST API returns the same short list.
--
-- A tech may UPDATE their own job (status to in_progress, notes, hours) but
-- may not create one, delete one, or reassign one away from themselves: the
-- WITH CHECK keeps assigned_tech_id pointing at them, so the row cannot be
-- edited out of their own visibility or onto a colleague.
-- ============================================================
drop policy if exists "shop_jobs: select own shop" on public.shop_jobs;
create policy "shop_jobs: select own shop"
  on public.shop_jobs for select
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or assigned_tech_id = public.shop_current_tech_id()
    )
  );

drop policy if exists "shop_jobs: insert by staff" on public.shop_jobs;
create policy "shop_jobs: insert by staff"
  on public.shop_jobs for insert
  to authenticated
  with check (
    shop_id = public.shop_current_shop_id()
    and public.shop_is_staff()
  );

drop policy if exists "shop_jobs: update own shop" on public.shop_jobs;
create policy "shop_jobs: update own shop"
  on public.shop_jobs for update
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or assigned_tech_id = public.shop_current_tech_id()
    )
  )
  with check (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or assigned_tech_id = public.shop_current_tech_id()
    )
  );

drop policy if exists "shop_jobs: delete by staff" on public.shop_jobs;
create policy "shop_jobs: delete by staff"
  on public.shop_jobs for delete
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and public.shop_is_staff()
  );


-- ============================================================
-- SHOP JOB LINE ITEMS
-- Visibility follows the parent job exactly, through shop_job_visible(): if a
-- tech cannot see the job, they cannot see what it billed. A tech CAN write
-- line items on their own job, because logging the labour hours and the parts
-- they pulled is the job.
-- ============================================================
drop policy if exists "shop_job_line_items: select via job" on public.shop_job_line_items;
create policy "shop_job_line_items: select via job"
  on public.shop_job_line_items for select
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and public.shop_job_visible(job_id)
  );

drop policy if exists "shop_job_line_items: insert via job" on public.shop_job_line_items;
create policy "shop_job_line_items: insert via job"
  on public.shop_job_line_items for insert
  to authenticated
  with check (
    shop_id = public.shop_current_shop_id()
    and public.shop_job_visible(job_id)
  );

drop policy if exists "shop_job_line_items: update via job" on public.shop_job_line_items;
create policy "shop_job_line_items: update via job"
  on public.shop_job_line_items for update
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and public.shop_job_visible(job_id)
  )
  with check (
    shop_id = public.shop_current_shop_id()
    and public.shop_job_visible(job_id)
  );

drop policy if exists "shop_job_line_items: delete via job" on public.shop_job_line_items;
create policy "shop_job_line_items: delete via job"
  on public.shop_job_line_items for delete
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and public.shop_job_visible(job_id)
  );


-- ============================================================
-- SHOP TIMECLOCK
-- Staff see and correct every punch in the shop -- that is what a timeclock
-- is for. A tech sees and writes ONLY their own punches: they cannot read a
-- colleague's hours, and they cannot punch anyone else in or out.
--
-- The tech_id test appears in WITH CHECK as well as USING on update, so a tech
-- cannot move one of their punches onto another tech's card.
-- ============================================================
drop policy if exists "shop_timeclock: select own shop" on public.shop_timeclock;
create policy "shop_timeclock: select own shop"
  on public.shop_timeclock for select
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or tech_id = public.shop_current_tech_id()
    )
  );

drop policy if exists "shop_timeclock: insert own shop" on public.shop_timeclock;
create policy "shop_timeclock: insert own shop"
  on public.shop_timeclock for insert
  to authenticated
  with check (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or tech_id = public.shop_current_tech_id()
    )
  );

drop policy if exists "shop_timeclock: update own shop" on public.shop_timeclock;
create policy "shop_timeclock: update own shop"
  on public.shop_timeclock for update
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

drop policy if exists "shop_timeclock: delete own shop" on public.shop_timeclock;
create policy "shop_timeclock: delete own shop"
  on public.shop_timeclock for delete
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or tech_id = public.shop_current_tech_id()
    )
  );


-- ============================================================
-- SHOP INVENTORY
-- Techs read, staff write (manageInventory). A tech has to be able to look up
-- a part to put it on a job; adjusting the count is a staff action, and the
-- audit trail in shop_inventory_transactions is why.
--
-- Note that unit_cost lives on this row, and a foreman may read it. Same
-- caveat as pay_rate: viewMargins is false for foreman in lib/permissions.ts
-- and that is an application-layer rule, because RLS cannot hide a column.
-- ============================================================
drop policy if exists "shop_inventory: select own shop" on public.shop_inventory;
create policy "shop_inventory: select own shop"
  on public.shop_inventory for select
  to authenticated
  using (shop_id = public.shop_current_shop_id());

drop policy if exists "shop_inventory: insert by staff" on public.shop_inventory;
create policy "shop_inventory: insert by staff"
  on public.shop_inventory for insert
  to authenticated
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_inventory: update by staff" on public.shop_inventory;
create policy "shop_inventory: update by staff"
  on public.shop_inventory for update
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff())
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_inventory: delete by staff" on public.shop_inventory;
create policy "shop_inventory: delete by staff"
  on public.shop_inventory for delete
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff());


-- ============================================================
-- SHOP INVENTORY TRANSACTIONS
-- Techs read, staff write -- the same rule as the stock lines themselves, and
-- deliberately so. This table is the ledger that explains the counts; letting
-- the role that cannot change a count write the ledger that justifies it
-- would make the audit trail worthless.
--
-- Consequence worth stating plainly: a tech pulling a part on their own job
-- cannot insert the matching 'used' transaction from their own session. That
-- write has to be performed by staff, or by a server route running on the
-- service-role key, which bypasses RLS. If the product later wants techs to
-- consume stock directly, the change is an extra INSERT policy here narrowed
-- to type = 'used' with shop_job_visible(job_id) -- not a widening of the
-- staff rule.
-- ============================================================
drop policy if exists "shop_inventory_transactions: select own shop" on public.shop_inventory_transactions;
create policy "shop_inventory_transactions: select own shop"
  on public.shop_inventory_transactions for select
  to authenticated
  using (shop_id = public.shop_current_shop_id());

drop policy if exists "shop_inventory_transactions: insert by staff" on public.shop_inventory_transactions;
create policy "shop_inventory_transactions: insert by staff"
  on public.shop_inventory_transactions for insert
  to authenticated
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_inventory_transactions: update by staff" on public.shop_inventory_transactions;
create policy "shop_inventory_transactions: update by staff"
  on public.shop_inventory_transactions for update
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff())
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_inventory_transactions: delete by staff" on public.shop_inventory_transactions;
create policy "shop_inventory_transactions: delete by staff"
  on public.shop_inventory_transactions for delete
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff());


-- ============================================================
-- SHOP SUBSCRIPTIONS
-- Readable by the whole shop, because every tier gate in the app reads it and
-- a tech's screen has to know whether Foreman AI is switched on. Writable by
-- managers only (manageBilling is manager-only in lib/permissions.ts).
--
-- In practice almost nothing writes here through a user session at all: the
-- Stripe webhook owns this table and runs on the service-role key, which is
-- not subject to RLS. These policies govern the manual case -- a manager
-- toggling an add-on in the billing screen.
-- ============================================================
drop policy if exists "shop_subscriptions: select own shop" on public.shop_subscriptions;
create policy "shop_subscriptions: select own shop"
  on public.shop_subscriptions for select
  to authenticated
  using (shop_id = public.shop_current_shop_id());

drop policy if exists "shop_subscriptions: insert by manager" on public.shop_subscriptions;
create policy "shop_subscriptions: insert by manager"
  on public.shop_subscriptions for insert
  to authenticated
  with check (
    shop_id = public.shop_current_shop_id()
    and public.shop_current_role() = 'manager'
  );

drop policy if exists "shop_subscriptions: update by manager" on public.shop_subscriptions;
create policy "shop_subscriptions: update by manager"
  on public.shop_subscriptions for update
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and public.shop_current_role() = 'manager'
  )
  with check (
    shop_id = public.shop_current_shop_id()
    and public.shop_current_role() = 'manager'
  );

drop policy if exists "shop_subscriptions: delete by manager" on public.shop_subscriptions;
create policy "shop_subscriptions: delete by manager"
  on public.shop_subscriptions for delete
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and public.shop_current_role() = 'manager'
  );


-- ============================================================
-- VERIFICATION, POST-APPLY
--
-- Every shop_* table should report rowsecurity = true:
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' and tablename like 'shop\_%';
--
-- 44 policies, all scoped to the authenticated role:
--   select tablename, policyname, cmd, roles from pg_policies
--    where schemaname = 'public' and tablename like 'shop\_%'
--    order by tablename, cmd;
--
-- And with the anon key, every one of these should return [] or an error,
-- never a row:
--   GET /rest/v1/shop_profiles?select=id
--   GET /rest/v1/shop_techs?select=id
--   GET /rest/v1/shop_subscriptions?select=id
-- while
--   POST /rest/v1/rpc/get_charter_slots_remaining
-- returns an integer.
-- ============================================================

-- ============================================================
-- END OF MIGRATION 007
-- ============================================================

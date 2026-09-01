-- ============================================================
-- NWI Shop
-- Migration: 009_shop_inspections.sql
-- shop_inspections — DOT annual/roadside and aerial-device inspections, in
-- ONE table.
-- Run this entire file in your Supabase SQL Editor, after 008.
-- ============================================================
--
-- WHY ONE TABLE AND NOT TWO
--
-- A DOT inspection and an aerial-device inspection are the same document with
-- a different checklist stapled to it: an inspector, a certification number, a
-- unit, a date, a pass/fail, a list of per-item verdicts, a list of
-- deficiencies, and a signature. The National Wrench Index app split these
-- into two tables and then had to write a helper that unions them back
-- together every time a screen wanted to answer "what compliance paperwork
-- exists for this truck" — which is the only question anybody ever asks. The
-- split bought nothing and cost a join.
--
-- Here it is one table with a `type` discriminator. The 10% that genuinely
-- differs is `cadence` (aerial has pre-use / frequent / annual intervals; DOT
-- does not) and that is expressed as a check constraint tying the two columns
-- together, so the database refuses a DOT row carrying an aerial cadence.
-- Everything else — including the checklist itself — is jsonb, because the
-- checklist is a form definition that changes when the regulation changes and
-- has no business being DDL.
--
-- Both are gated by shop type, not by this table: `dot_inspections` and
-- `aerial_inspections` are separate ShopFeature values in lib/permissions.ts
-- (both heavy duty, both starter tier) and the app decides which `type` a
-- given shop may create. RLS does not, and should not, know about features.
--
-- POLICIES ARE IN THIS FILE. 001–006 deferred every policy to 007 because
-- they were written as one batch; a table added afterwards carries its own,
-- otherwise it sits with RLS on and zero policies — denying everything — until
-- somebody remembers to go back and edit 007. Every file from 009 on follows
-- this rule.
-- ============================================================


-- ============================================================
-- SHOP INSPECTIONS
-- ============================================================
create table if not exists public.shop_inspections (
  id                    uuid        primary key default gen_random_uuid(),
  shop_id               uuid        not null references public.shop_profiles(id) on delete cascade,

  -- The discriminator. NOT NULL: a merged table whose type column can be null
  -- is a merged table with rows that belong to neither form, and every read
  -- path would have to defend against a third case that means nothing.
  type                  text        not null check (type in ('dot', 'aerial')),

  -- Aerial only. Its constraint spans two columns so it is written as a named
  -- table constraint at the foot of this definition rather than inline here.
  cadence               text,

  -- ON DELETE SET NULL, all three, and this is the important line in the file.
  -- A completed inspection is a COMPLIANCE DOCUMENT: it is evidence that a
  -- qualified person looked at a specific unit on a specific date and signed
  -- their name to the result. It has to outlive the work order it was found
  -- on, the vehicle record somebody later merged, and the customer who took
  -- their fleet elsewhere. Deleting any of those must break the link and leave
  -- the document standing. Nothing here may ever be CASCADE.
  --
  -- unit_number, carrier_name, license_plate and inspector_name below are the
  -- other half of that promise: denormalised copies captured at signing time,
  -- so the document still reads correctly after the row it was copied from is
  -- gone or has been edited.
  job_id                uuid        references public.shop_jobs(id)      on delete set null,
  vehicle_id            uuid        references public.shop_vehicles(id)  on delete set null,
  customer_id           uuid        references public.shop_customers(id) on delete set null,
  unit_number           text,

  -- The inspector as a link, and the inspector as a name. Both, for the same
  -- reason: the tech row can be deactivated or deleted, the printed name on
  -- the certificate cannot change. inspector_name is NOT NULL because a DOT
  -- inspection report without an inspector's name on it is not a valid report
  -- — the federal form has a box for it and the box is not optional.
  inspector_tech_id     uuid        references public.shop_techs(id) on delete set null,
  inspector_name        text        not null,
  inspector_cert_number text,

  -- Nullable: a report can exist before its verdict is entered. The app
  -- decides when a null result may be printed; the database does not guess a
  -- pass.
  result                text        check (result in ('pass', 'fail')),

  -- Per-item verdicts, one object per checklist line. jsonb and not a child
  -- table on purpose: the checklist is a FORM, its shape is set by the
  -- regulation and the vendor's manual rather than by us, and it changes
  -- without warning. A child table would turn every checklist revision into a
  -- migration. Nothing queries inside these arrays — they are read whole, by
  -- one screen and one PDF.
  items                 jsonb       not null default '[]'::jsonb,
  deficiencies          jsonb       not null default '[]'::jsonb,

  violations            text,

  -- 49 CFR 396.9 out-of-service. Its own boolean rather than derived from
  -- result = 'fail', because they are different findings: a unit can fail an
  -- inspection on something that does not ground it.
  removed_from_service  boolean     not null default false,

  carrier_name          text,
  carrier_address       text,
  license_plate         text,
  odometer              int,

  -- A PNG data URL, in a TEXT column. This matches how the National Wrench
  -- Index app already stores signatures, and matching it is the point: the two
  -- apps share a project and will eventually share a PDF renderer, and a
  -- renderer that has to handle two signature encodings is a renderer with a
  -- bug in it. Not bytea, not a storage-bucket path.
  signature_data        text,

  -- SEPARATE FROM locked_at, DELIBERATELY.
  --
  -- These two timestamps answer different questions and the answers differ in
  -- practice. signed_at is when a human put their name to the result — the
  -- date that goes on the certificate and the date an auditor counts from.
  -- locked_at is when this row stopped being editable, which is a fact about
  -- our software and about nothing else.
  --
  -- They are usually seconds apart and occasionally days: an inspection
  -- performed on paper in the yard on Friday and typed in on Monday has a
  -- Friday signature and a Monday lock. NWI Suite stores one timestamp for
  -- both and its PDF has to guess which one the certificate should show; it
  -- guesses wrong in exactly the case that matters, the back-dated entry. Two
  -- columns, no guessing.
  signed_at             timestamptz,

  -- Locked on arrival. An inspection is written by a person filling in a form
  -- and pressing submit once; there is no draft state in this workflow, so the
  -- honest default is true rather than false-then-lock.
  --
  -- HONEST STATEMENT OF WHAT THIS DOES: `locked` is a flag, not a constraint.
  -- The update policies below let staff (and the inspecting tech) update the
  -- row regardless of its value, because a locked record still needs a
  -- correction path and RLS cannot express "no longer editable" without also
  -- blocking the correction. Respecting `locked` is application-layer work,
  -- the same class of rule as viewMargins in lib/permissions.ts. If it ever
  -- has to be a real boundary the fix is a BEFORE UPDATE trigger that rejects
  -- changes to a locked row, not another policy.
  locked                boolean     not null default true,
  locked_at             timestamptz not null default now(),

  created_at            timestamptz not null default now(),

  -- THE ONE PLACE THE MERGED TABLE PAYS FOR ITSELF.
  --
  -- A table constraint rather than a check hung off the cadence column,
  -- because it reads two columns and this form says so plainly and carries a
  -- name we chose. It is deliberately ONE-DIRECTIONAL: an aerial inspection
  -- MAY carry a cadence, a DOT inspection may NOT. Aerial with a null cadence
  -- is allowed on purpose, because an out-of-cycle aerial inspection — after a
  -- repair, say — is a real thing that belongs to no interval.
  --
  -- This is the whole cost of putting both forms in one table, and it is one
  -- constraint. The alternative NWI Suite chose — two tables — cost a union
  -- helper on every read.
  constraint shop_inspections_cadence_by_type_check check (
    cadence is null
    or (type = 'aerial' and cadence in ('pre_use', 'frequent', 'annual'))
  )
);

create index if not exists idx_shop_inspections_shop_id
  on public.shop_inspections(shop_id);

-- The inspection list: one shop, newest first, optionally narrowed to DOT or
-- aerial. This is the screen that opens when the tool is clicked.
create index if not exists idx_shop_inspections_shop_type_created
  on public.shop_inspections(shop_id, type, created_at desc);

-- "What paperwork exists for this unit" — the compliance question, asked from
-- the vehicle record. Partial: an inspection with no vehicle link (a walk-in,
-- or one whose vehicle row was later deleted) never answers it.
create index if not exists idx_shop_inspections_vehicle_id
  on public.shop_inspections(vehicle_id)
  where vehicle_id is not null;

create index if not exists idx_shop_inspections_job_id
  on public.shop_inspections(job_id)
  where job_id is not null;

create index if not exists idx_shop_inspections_customer_id
  on public.shop_inspections(customer_id)
  where customer_id is not null;

-- A tech's own inspections: serves the tech-scoped write policies below and
-- the "inspections I signed" list on their dashboard.
create index if not exists idx_shop_inspections_inspector_tech_id
  on public.shop_inspections(inspector_tech_id)
  where inspector_tech_id is not null;

-- The out-of-service list. Small, urgent, and asked for by name.
create index if not exists idx_shop_inspections_oos
  on public.shop_inspections(shop_id)
  where removed_from_service;

comment on table public.shop_inspections is
  'DOT and aerial-device inspections in one table, discriminated by `type`. Job, vehicle and customer links are ON DELETE SET NULL because a signed inspection is a compliance document that must outlive them. signed_at (when a human signed) is separate from locked_at (when the row became read-only) on purpose.';

comment on column public.shop_inspections.signature_data is
  'PNG data URL in a TEXT column, matching how the National Wrench Index app stores signatures so one PDF renderer can serve both.';


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.shop_inspections enable row level security;

grant select, insert, update, delete on public.shop_inspections to authenticated;
revoke all on public.shop_inspections from anon;

-- READ: the whole shop. A tech about to put a truck on the lift needs to know
-- whether it is out of service, and that answer cannot depend on who signed
-- the last inspection. Compliance paperwork is shop-wide reading, like
-- customers and bays in 007 — not personal like a timeclock punch.
drop policy if exists "shop_inspections: select own shop" on public.shop_inspections;
create policy "shop_inspections: select own shop"
  on public.shop_inspections for select
  to authenticated
  using (shop_id = public.shop_current_shop_id());

-- WRITE: staff anywhere in their shop; a tech only as themselves.
--
-- The tech branch has two halves and both matter. inspector_tech_id must be
-- the caller, so a tech cannot sign a document in a colleague's name — the
-- same rule as tech_id on shop_timeclock in 007, and here it is a signature,
-- so it matters more. And where the inspection hangs off a job,
-- shop_job_visible(job_id) must pass, so a tech cannot attach paperwork to a
-- work order that is not on their board; that helper is used rather than a
-- hand-written test so this scoping tracks the job board exactly, including
-- any later change to who can see a job. `job_id is null or ...` because a
-- standalone inspection — a fleet customer driving in for an annual with no
-- work order raised — is the normal case for this tool, not an edge case.
drop policy if exists "shop_inspections: insert own shop" on public.shop_inspections;
create policy "shop_inspections: insert own shop"
  on public.shop_inspections for insert
  to authenticated
  with check (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or (
        inspector_tech_id = public.shop_current_tech_id()
        and (job_id is null or public.shop_job_visible(job_id))
      )
    )
  );

-- WITH CHECK repeats the whole predicate, as in 007: USING governs the row as
-- it was, WITH CHECK the row as it will be. Without the second a tech could
-- update inspector_tech_id to a colleague and hand off authorship of a signed
-- document.
drop policy if exists "shop_inspections: update own shop" on public.shop_inspections;
create policy "shop_inspections: update own shop"
  on public.shop_inspections for update
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or (
        inspector_tech_id = public.shop_current_tech_id()
        and (job_id is null or public.shop_job_visible(job_id))
      )
    )
  )
  with check (
    shop_id = public.shop_current_shop_id()
    and (
      public.shop_is_staff()
      or (
        inspector_tech_id = public.shop_current_tech_id()
        and (job_id is null or public.shop_job_visible(job_id))
      )
    )
  );

-- DELETE: staff only, and narrower than the write rule above on purpose.
-- Everywhere else in this schema a role that may write a row may delete it;
-- here the row is the evidence that an inspection happened. A tech who signed
-- a failing inspection is precisely the person who should not be able to make
-- it disappear. Managers and foremen keep the ability because a mistyped
-- duplicate has to be removable by someone.
drop policy if exists "shop_inspections: delete by staff" on public.shop_inspections;
create policy "shop_inspections: delete by staff"
  on public.shop_inspections for delete
  to authenticated
  using (
    shop_id = public.shop_current_shop_id()
    and public.shop_is_staff()
  );


-- ============================================================
-- VERIFICATION, POST-APPLY
--
-- The table exists and RLS is on:
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' and tablename = 'shop_inspections';
--
-- Four policies, all on the authenticated role:
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'public' and tablename = 'shop_inspections'
--    order by cmd;
--
-- Eight indexes — the primary key plus the seven above:
--   select indexname, indexdef from pg_indexes
--    where schemaname = 'public' and tablename = 'shop_inspections'
--    order by indexname;
--
-- The cross-column constraint is present under the name we chose:
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.shop_inspections'::regclass
--      and conname  = 'shop_inspections_cadence_by_type_check';
--
-- And it bites in one direction and not the other. The first insert
-- must FAIL, the next two must SUCCEED (roll it all back either way):
--   begin;
--   insert into public.shop_inspections (shop_id, type, cadence, inspector_name)
--     values ('<a real shop id>', 'dot', 'annual', 'Test');
--   rollback;
--
--   begin;
--   insert into public.shop_inspections (shop_id, type, cadence, inspector_name)
--     values ('<a real shop id>', 'aerial', 'annual', 'Test');
--   insert into public.shop_inspections (shop_id, type, cadence, inspector_name)
--     values ('<a real shop id>', 'aerial', null, 'Test');
--   rollback;
--
-- The three optional links are SET NULL, not CASCADE. This is the one that
-- must never regress — expect confdeltype = 'n' on all three:
--   select conname, confdeltype
--     from pg_constraint
--    where conrelid = 'public.shop_inspections'::regclass
--      and contype  = 'f'
--    order by conname;
--
-- And prove it end to end: delete a job that has an inspection on it, then
--   select id, job_id from public.shop_inspections where id = '<that row>';
-- must still return the row, with job_id null. Roll back.
--
-- With the anon key this must return [] or an error, never a row:
--   GET /rest/v1/shop_inspections?select=id
-- ============================================================

-- ============================================================
-- END OF MIGRATION 009
-- ============================================================

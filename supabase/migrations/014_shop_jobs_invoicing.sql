-- ============================================================
-- NWI Shop
-- Migration: 014_shop_jobs_invoicing.sql
-- Invoicing and NWI Garage sync columns on shop_jobs.
-- Run this entire file in your Supabase SQL Editor, after 013.
-- ============================================================
--
-- This is an ALTER against a live, populated table, like 008. Every column is
-- added with `if not exists` and every one is nullable, so existing rows are
-- correct the instant it lands and no backfill pass is needed: a job that was
-- never invoiced has a null invoice_number, which is the true answer.
--
-- WHY THESE LIVE ON shop_jobs AND NOT IN A shop_invoices TABLE.
--
-- Because in this product an invoice is not a separate document — it is a job
-- in the 'invoiced' status, printed. 003 already models that: `status` reaches
-- 'invoiced', `invoiced_at` records when, and `voided` exists precisely
-- because "an invoiced job is a financial record". The line items are already
-- on the job. A shop_invoices table would be a second row holding a foreign
-- key to the job and nothing else of its own, plus a whole new class of bug
-- where the two disagree about what was billed.
--
-- The moment that stops being true — a credit note, a part-payment schedule,
-- an invoice spanning several work orders — is the moment to add the table.
-- Until then these are six columns on the row that already exists.
-- ============================================================


-- ============================================================
-- INVOICE COLUMNS
-- ============================================================

-- The human-facing number, distinct from job_number (003). They are different
-- sequences with different meanings: job_number is assigned at intake by the
-- trigger in 003 and counts work, invoice_number is assigned at billing and
-- counts money. A shop's accountant cares that the second has no gaps; a job
-- that never gets billed would put a gap in it. TEXT rather than integer
-- because shops carry prefixes across from whatever they used before —
-- 'INV-1043', '2026-0088' — and the numbering is theirs, not ours.
alter table public.shop_jobs
  add column if not exists invoice_number text;

alter table public.shop_jobs
  add column if not exists invoice_sent_at timestamptz;

-- The customer's link to their own invoice. Unguessable and bearer-only: the
-- person opening it has no account, so this token IS the authorisation. It
-- must be generated with a CSPRNG in application code — never sequential,
-- never derived from the job id or the invoice number — and it must be
-- nullable, because a job that has not been sent to anyone should have no
-- live link at all.
--
-- READ THIS BEFORE WIRING UP THE PUBLIC PAGE: `anon` has no grant on
-- shop_jobs (007 revokes it) and this file adds no policy for `anon`. That is
-- deliberate and it is not an oversight to be fixed by adding one. A policy
-- like `using (invoice_public_token is not null)` would hand every
-- unauthenticated visitor every invoiced job in the system, because RLS
-- evaluates the policy against rows, not against what the caller typed — the
-- token in the URL is not part of the predicate. The public invoice page must
-- be a server route on the service-role key that looks the token up itself and
-- returns one job. There is no correct RLS-only version of this.
alter table public.shop_jobs
  add column if not exists invoice_public_token text;

-- Separate from invoiced_at (003) and from invoice_sent_at above, because
-- billed, sent and paid are three different events that a shop chases
-- separately. Collapsing any two of them loses the accounts-receivable report,
-- which is the entire question "what has gone out and not come back".
alter table public.shop_jobs
  add column if not exists paid_at timestamptz;


-- ============================================================
-- NWI GARAGE SYNC COLUMNS
--
-- NWI Garage is the vehicle-owner side of the National Wrench Index product:
-- a completed job here can be pushed there as a service record on the owner's
-- vehicle history. `garage_sync` is a ShopFeature in lib/permissions.ts,
-- available to every shop type at starter tier.
-- ============================================================

alter table public.shop_jobs
  add column if not exists garage_posted_at timestamptz;

-- The id of the record we created on the other side. NO FOREIGN KEY, and that
-- is deliberate rather than forgotten: the target row belongs to the National
-- Wrench Index app's own tables, which NWI Shop does not own and must not
-- constrain. A real FK here would let a change in the other app's schema — a
-- table rename, a cascade someone adds — reach across and delete or block
-- writes to shop work orders. It is a loose reference, checked by the sync
-- code, and a dangling value means "the record was removed over there", which
-- is information worth keeping rather than an integrity failure.
--
-- Paired with garage_posted_at rather than replacing it: the timestamp says a
-- push happened, the id says what it produced, and a push that succeeded
-- remotely but whose response we lost has the first without the second — which
-- is exactly the row the retry job needs to find.
alter table public.shop_jobs
  add column if not exists garage_service_record_id uuid;


-- ============================================================
-- INDEXES
-- ============================================================

-- The token is the credential on a public URL, so a collision is not a data
-- quality problem, it is one customer being shown another customer's invoice.
-- UNIQUE, and partial so the overwhelming majority of jobs — every job never
-- sent to anyone — cost nothing to store here. Postgres would in fact allow
-- duplicate nulls in a plain unique index, but the partial form also keeps the
-- index small and makes the intent unmistakable.
create unique index if not exists idx_shop_jobs_invoice_public_token_unique
  on public.shop_jobs(invoice_public_token)
  where invoice_public_token is not null;

-- Invoice numbers are unique PER SHOP, exactly like job_number in 003 — shop
-- A's INV-1043 and shop B's INV-1043 are different invoices. Partial on
-- `is not null` so the vast majority of rows (estimates, open work) are not in
-- the index and are not competing for the same absent value.
create unique index if not exists idx_shop_jobs_shop_invoice_number_unique
  on public.shop_jobs(shop_id, invoice_number)
  where invoice_number is not null;

-- Accounts receivable: invoiced, not paid, oldest first. The only new read
-- path these columns create that the existing indexes do not already serve.
create index if not exists idx_shop_jobs_unpaid
  on public.shop_jobs(shop_id, invoiced_at)
  where invoiced_at is not null and paid_at is null and not voided;

-- The Garage sync retry queue: completed work that has not been pushed.
create index if not exists idx_shop_jobs_garage_unposted
  on public.shop_jobs(shop_id, completed_at)
  where completed_at is not null and garage_posted_at is null and not voided;


comment on column public.shop_jobs.invoice_number is
  'Human-facing invoice number, unique per shop. Distinct from job_number (003): job_number counts work and is assigned at intake, invoice_number counts money and is assigned at billing. TEXT because shops carry their own prefixed numbering across.';

comment on column public.shop_jobs.invoice_public_token is
  'Bearer credential for the public invoice page. CSPRNG-generated in application code. anon has NO grant on shop_jobs and must not be given one — the public page is a service-role server route that resolves this token, not an RLS policy.';

comment on column public.shop_jobs.garage_service_record_id is
  'Id of the service record created in NWI Garage. Intentionally no foreign key: that row belongs to the other app in this project and NWI Shop must not constrain it.';


-- ============================================================
-- ROW LEVEL SECURITY — NO CHANGE NEEDED
--
-- The same note as 008, and for the same reason. RLS is row-level: the four
-- shop_jobs policies in 007 gate whole rows on shop_id plus assigned_tech_id,
-- and every column of a row a caller may read is already covered, including
-- ones added after the policy was written. These six columns need no policy
-- and this file adds none.
--
-- One consequence worth saying out loud, because it is the mirror of the
-- pay_rate note in 007: a TECH assigned to a job can read that job's row, and
-- therefore can read its invoice_public_token. If that ever matters — if the
-- token has to be invisible to the floor — the fix is to move it to its own
-- staff-only table or to a column-level grant, NOT another policy on
-- shop_jobs, because no row policy can hide one column of a row the caller is
-- allowed to read.
-- ============================================================


-- ============================================================
-- VERIFICATION, POST-APPLY
--
-- All six columns exist and every one is nullable:
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name   = 'shop_jobs'
--      and column_name in ('invoice_number', 'invoice_sent_at',
--                          'invoice_public_token', 'paid_at',
--                          'garage_posted_at', 'garage_service_record_id')
--    order by column_name;
--
-- No existing row was disturbed — every count below should be 0:
--   select count(*) filter (where invoice_number       is not null) as numbered,
--          count(*) filter (where invoice_public_token is not null) as tokened,
--          count(*) filter (where paid_at              is not null) as paid
--     from public.shop_jobs;
--
-- Both unique indexes are present and partial:
--   select indexname, indexdef from pg_indexes
--    where schemaname = 'public'
--      and tablename  = 'shop_jobs'
--      and indexname like 'idx_shop_jobs_%'
--    order by indexname;
--
-- The token index bites across shops — this must fail on the second insert,
-- even though the two jobs are in different shops:
--   begin;
--   update public.shop_jobs set invoice_public_token = 'tok-x' where id = '<job in shop A>';
--   update public.shop_jobs set invoice_public_token = 'tok-x' where id = '<job in shop B>';
--   rollback;
--
-- The invoice number index bites WITHIN a shop and not across it. The first
-- must fail, the second must succeed:
--   begin;
--   update public.shop_jobs set invoice_number = 'INV-1' where id = '<job A in shop A>';
--   update public.shop_jobs set invoice_number = 'INV-1' where id = '<job B in shop A>';
--   rollback;
--
--   begin;
--   update public.shop_jobs set invoice_number = 'INV-1' where id = '<job in shop A>';
--   update public.shop_jobs set invoice_number = 'INV-1' where id = '<job in shop B>';
--   rollback;
--
-- And many jobs may still have no invoice number at all — the partial index
-- must not treat nulls as colliding:
--   select count(*) from public.shop_jobs where invoice_number is null;
--
-- Policy count on shop_jobs is unchanged at 4 — this file adds none:
--   select count(*) from pg_policies
--    where schemaname = 'public' and tablename = 'shop_jobs';
--
-- With the anon key this must still return [] or an error:
--   GET /rest/v1/shop_jobs?select=invoice_public_token
-- ============================================================

-- ============================================================
-- END OF MIGRATION 014
-- ============================================================

-- ============================================================
-- NWI Shop
-- Migration: 011_shop_reviews.sql
-- TorqueWrench: shop_review_requests (one per job) and shop_review_settings
-- (one per shop).
-- Run this entire file in your Supabase SQL Editor, after 010.
-- ============================================================
--
-- WHAT TORQUEWRENCH DOES
--
-- A job is invoiced; some minutes later the customer gets one text message
-- asking how it went. A high rating sends them to the shop's Google review
-- page. A low one does not — it opens a service-recovery path that puts the
-- complaint in front of the shop instead of in front of the internet. Both
-- halves are counted, so the shop can see how many requests went out, how many
-- were opened, and what came back.
--
-- ALMOST NOTHING HERE IS WRITTEN THROUGH A USER SESSION. The enqueue, the
-- send, the click callback and the rating all happen in server routes on the
-- service-role key, which is not subject to RLS. The policies below govern the
-- one human case: a manager or foreman looking at the TorqueWrench screen and
-- editing the settings. The rating page the customer opens is anonymous and
-- goes through a server route that looks up `token` — `anon` is granted
-- nothing on either table and must stay that way, because a table that anon
-- can select is a table where a stranger can enumerate every customer phone
-- number the shop has queued.
-- ============================================================


-- ============================================================
-- SHOP REVIEW REQUESTS
-- One row per job, enforced by the unique index below.
-- ============================================================
create table if not exists public.shop_review_requests (
  id                          uuid        primary key default gen_random_uuid(),
  shop_id                     uuid        not null references public.shop_profiles(id) on delete cascade,

  -- CASCADE, and the only CASCADE among the optional links in this schema.
  -- This is not a record of anything that happened in the shop — it is a queue
  -- entry and a delivery receipt for one specific job. With the job gone there
  -- is no message to send and nothing the row could be evidence of. Contrast
  -- shop_inspections and shop_epa_log, where the row is the point and the job
  -- is incidental.
  job_id                      uuid        not null references public.shop_jobs(id) on delete cascade,

  -- SET NULL: the send has already happened, and `phone` below holds what it
  -- was actually sent to. Deleting the customer must not delete the record of
  -- a message that went out.
  customer_id                 uuid        references public.shop_customers(id) on delete set null,

  -- Copied off the customer at enqueue time. The number that was texted is a
  -- fact about the send; the number on the customer record today is not.
  phone                       text,

  -- The full life of a request, in one column.
  --   pending   enqueued, delay timer running
  --   sent      the message went out
  --   skipped   deliberately not sent (customer.no_sms, no phone on file,
  --             the shop switched TorqueWrench off between enqueue and send)
  --   failed    the carrier or Twilio rejected it; see `error`
  --   rated     the customer came back and gave a rating
  --   recovery  the rating was low and service recovery was triggered
  -- `skipped` and `failed` are separate states because the first is a decision
  -- and the second is a fault, and only one of them is worth alerting a shop
  -- about.
  status                      text        not null default 'pending'
                                          check (status in ('pending', 'sent', 'skipped',
                                                            'failed', 'rated', 'recovery')),

  -- send_attempted_at and send_attempts exist so a retry loop cannot become an
  -- infinite one, and so a stuck row is visible rather than silent. sent_at is
  -- separate from send_attempted_at for the same reason signed_at is separate
  -- from locked_at in 009: one records what we tried, the other records what
  -- succeeded, and conflating them loses the failure.
  send_attempted_at           timestamptz,
  send_attempts               int         not null default 0,
  sent_at                     timestamptz,

  clicked_at                  timestamptz,

  -- 1-5. Constrained because every branch downstream — the recovery trigger,
  -- the average on the dashboard — assumes a five-star scale, and a 0 or a 7
  -- would quietly skew both. Null until the customer answers.
  rating                      int         check (rating is null
                                                 or (rating >= 1 and rating <= 5)),
  rated_at                    timestamptz,

  -- Denormalised from status = 'recovery' on purpose: status moves on, and the
  -- shop still needs to be able to count how many recoveries were triggered
  -- over a quarter.
  service_recovery_triggered  boolean     not null default false,

  -- The customer's link. Unguessable, and the only credential on the public
  -- rating page — so it must be generated with a CSPRNG in application code,
  -- never from anything sequential or time-derived. UNIQUE both because a
  -- collision would show one customer another's job and because the lookup is
  -- by this column and wants the index anyway.
  token                       text        not null unique,

  -- The provider's rejection, kept verbatim. Diagnosing "why did this shop's
  -- texts stop" a week later is impossible without it.
  error                       text,

  created_at                  timestamptz not null default now()
);

-- ONE REQUEST PER JOB, ENFORCED HERE AND NOT IN APPLICATION CODE.
--
-- NWI Suite dedupes this in the enqueue path with a select-then-insert, which
-- is a race with itself: two invoicing actions on the same job seconds apart
-- both find nothing and both insert, and the customer gets two texts asking
-- the same question. Under a webhook that retries, this is not hypothetical.
--
-- A unique index cannot lose that race. The enqueue path becomes an upsert
-- (`on conflict (job_id) do nothing`) and the second caller is refused by the
-- database rather than by a check that happened a moment too early.
create unique index if not exists idx_shop_review_requests_job_id_unique
  on public.shop_review_requests(job_id);

create index if not exists idx_shop_review_requests_shop_id
  on public.shop_review_requests(shop_id);

-- The sender: everything still waiting to go out. Partial, because the queue
-- is tiny and the history is not.
create index if not exists idx_shop_review_requests_pending
  on public.shop_review_requests(created_at)
  where status = 'pending';

-- The TorqueWrench dashboard: this shop's requests, newest first, grouped by
-- how they ended.
create index if not exists idx_shop_review_requests_shop_status
  on public.shop_review_requests(shop_id, status);

create index if not exists idx_shop_review_requests_customer_id
  on public.shop_review_requests(customer_id)
  where customer_id is not null;

comment on table public.shop_review_requests is
  'TorqueWrench review request, one per job — the unique index on job_id is what guarantees that, rather than a dedupe check in the enqueue path. Written almost entirely by service-role server routes; the policies govern staff reading the dashboard.';


-- ============================================================
-- SHOP REVIEW SETTINGS
-- One row per shop. Separate from shop_profiles because it is feature
-- configuration rather than shop identity: a shop that never buys
-- TorqueWrench never grows a row here, and the defaults live in one place
-- instead of as six more nullable columns on the profile.
-- ============================================================
create table if not exists public.shop_review_settings (
  id                    uuid        primary key default gen_random_uuid(),
  shop_id               uuid        not null references public.shop_profiles(id) on delete cascade,

  -- The master switch, defaulting to OFF. A shop that has not deliberately
  -- turned this on must not start texting its customers because a row appeared
  -- — the sender reads this on every send, not just at enqueue.
  is_enabled            boolean     not null default false,

  -- Where a happy customer is sent. Mirrors shop_profiles.google_place_id
  -- (added in 015): the profile column is the shop's own identity and is what
  -- the app pre-fills from, this one is TorqueWrench's override for a shop
  -- that wants reviews pointed at a different listing. TorqueWrench reads THIS
  -- column and falls back to the profile when it is null. Do not "tidy" the
  -- duplication by deleting one of them without deciding which is
  -- authoritative first.
  google_place_id       text,

  -- Where an unhappy one lands instead. Distinct from shop_profiles.phone,
  -- because service recovery should ring the owner's mobile, not the front
  -- counter.
  service_recovery_phone text,

  -- How long after invoicing to wait. Minutes rather than a timestamp offset
  -- type so the settings screen can show a plain number. Default 60: long
  -- enough that the customer has left, short enough that the visit is fresh.
  delay_minutes         int         not null default 60,

  -- Null means "use the built-in copy". Kept nullable rather than defaulted to
  -- a literal, so improving the default message does not require rewriting
  -- every row that never customised it.
  message_template      text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- One settings row per shop. Same reasoning as idx_shop_subscriptions_shop_id
-- in 006: the settings screen upserts on this, and without the constraint a
-- double-save creates a second row and the sender starts reading whichever
-- comes back first.
create unique index if not exists idx_shop_review_settings_shop_id_unique
  on public.shop_review_settings(shop_id);

drop trigger if exists set_shop_review_settings_updated_at on public.shop_review_settings;
create trigger set_shop_review_settings_updated_at
  before update on public.shop_review_settings
  for each row execute procedure public.shop_set_updated_at();


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.shop_review_requests enable row level security;
alter table public.shop_review_settings enable row level security;

grant select, insert, update, delete on public.shop_review_requests to authenticated;
grant select, insert, update, delete on public.shop_review_settings to authenticated;

revoke all on public.shop_review_requests from anon;
revoke all on public.shop_review_settings from anon;


-- ------------------------------------------------------------
-- SHOP REVIEW REQUESTS — STAFF ONLY, INCLUDING READ.
--
-- The exception to the shop-wide read that customers, bays and inspections
-- get. Every row here is a customer's mobile number paired with their opinion
-- of the shop, and a tech has no reason to hold that list — least of all the
-- tech whose job the low rating is about. viewAllJobs is false for tech in
-- lib/permissions.ts and this is the same instinct applied to the follow-up.
--
-- These four policies are close to unused in practice: the pipeline runs on
-- the service-role key. They exist so the dashboard read is correct and so
-- that nothing else can be.
-- ------------------------------------------------------------
drop policy if exists "shop_review_requests: select by staff" on public.shop_review_requests;
create policy "shop_review_requests: select by staff"
  on public.shop_review_requests for select
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_review_requests: insert by staff" on public.shop_review_requests;
create policy "shop_review_requests: insert by staff"
  on public.shop_review_requests for insert
  to authenticated
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_review_requests: update by staff" on public.shop_review_requests;
create policy "shop_review_requests: update by staff"
  on public.shop_review_requests for update
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff())
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_review_requests: delete by staff" on public.shop_review_requests;
create policy "shop_review_requests: delete by staff"
  on public.shop_review_requests for delete
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff());


-- ------------------------------------------------------------
-- SHOP REVIEW SETTINGS — shop-wide read, staff write.
--
-- Deliberately looser on read than shop_review_requests above, and the
-- difference is the point: the settings row holds no customer data at all,
-- only whether the feature is on and where it points. Letting a tech read it
-- costs nothing and lets any screen ask "is TorqueWrench live here" without a
-- role check first. The requests table, which does hold customer data, stays
-- shut.
-- ------------------------------------------------------------
drop policy if exists "shop_review_settings: select own shop" on public.shop_review_settings;
create policy "shop_review_settings: select own shop"
  on public.shop_review_settings for select
  to authenticated
  using (shop_id = public.shop_current_shop_id());

drop policy if exists "shop_review_settings: insert by staff" on public.shop_review_settings;
create policy "shop_review_settings: insert by staff"
  on public.shop_review_settings for insert
  to authenticated
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_review_settings: update by staff" on public.shop_review_settings;
create policy "shop_review_settings: update by staff"
  on public.shop_review_settings for update
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff())
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_review_settings: delete by staff" on public.shop_review_settings;
create policy "shop_review_settings: delete by staff"
  on public.shop_review_settings for delete
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff());


-- ============================================================
-- VERIFICATION, POST-APPLY
--
-- Both tables present with RLS on:
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public'
--      and tablename in ('shop_review_requests', 'shop_review_settings');
--
-- Eight policies, four on each:
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public'
--      and tablename in ('shop_review_requests', 'shop_review_settings')
--    order by tablename, cmd;
--
-- ONE REQUEST PER JOB. The second insert must fail with a unique violation:
--   begin;
--   insert into public.shop_review_requests (shop_id, job_id, token)
--     values ('<a real shop id>', '<a real job id>', 'tok-a');
--   insert into public.shop_review_requests (shop_id, job_id, token)
--     values ('<a real shop id>', '<a real job id>', 'tok-b');
--   rollback;
--
-- And the token is unique too — this must also fail:
--   begin;
--   insert into public.shop_review_requests (shop_id, job_id, token)
--     values ('<a real shop id>', '<job A>', 'tok-dup');
--   insert into public.shop_review_requests (shop_id, job_id, token)
--     values ('<a real shop id>', '<job B>', 'tok-dup');
--   rollback;
--
-- The rating range bites — 0 and 6 must both fail, 1 through 5 must pass:
--   begin;
--   update public.shop_review_requests set rating = 6 where id = '<a row>';
--   rollback;
--
-- job_id cascades and customer_id does not (expect 'c' then 'n'):
--   select conname, confdeltype
--     from pg_constraint
--    where conrelid = 'public.shop_review_requests'::regclass
--      and contype  = 'f'
--    order by conname;
--
-- The updated_at trigger is on settings and fires:
--   select tgname from pg_trigger
--    where tgrelid = 'public.shop_review_settings'::regclass
--      and not tgisinternal;
--
-- With the anon key, BOTH of these must return [] or an error. If either
-- returns a row, every queued customer phone number in the system is public:
--   GET /rest/v1/shop_review_requests?select=phone
--   GET /rest/v1/shop_review_settings?select=service_recovery_phone
-- ============================================================

-- ============================================================
-- END OF MIGRATION 011
-- ============================================================

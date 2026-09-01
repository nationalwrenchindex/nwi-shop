-- ============================================================
-- NWI Shop
-- Migration: 013_shop_foreman.sql
-- Foreman AI: shop_foreman_settings (one per shop) and shop_foreman_calls
-- (the call log).
-- Run this entire file in your Supabase SQL Editor, after 012.
-- ============================================================
--
-- WHAT FOREMAN AI IS
--
-- A voice agent that answers the shop phone. It knows the hours, the services
-- and the greeting from shop_foreman_settings; every call it takes lands in
-- shop_foreman_calls with a transcript, a summary and an outcome, optionally
-- linked to the job or customer it turned into.
--
-- It is a paid add-on, not a tier: `foreman_ai` on shop_subscriptions (006) is
-- what the shop bought and `is_enabled` here is whether the phone number is
-- live right now. Both have to be true for the agent to answer. Neither is
-- checked by RLS — feature gating is application-layer work, exactly as noted
-- in 008.
--
-- WRITES COME FROM A WEBHOOK. Vapi posts the call record to a server route
-- running on the service-role key, which bypasses RLS entirely. The policies
-- below govern the human case only: staff reading the call log and editing the
-- settings.
--
-- BOTH TABLES ARE STAFF-ONLY, INCLUDING READ. A transcript is a recording of a
-- customer talking to the shop — complaints, prices quoted, sometimes a card
-- number read aloud. That is the most sensitive text in this schema and it is
-- not shop-wide reading. Techs see none of it.
-- ============================================================


-- ============================================================
-- SHOP FOREMAN SETTINGS
-- One row per shop.
-- ============================================================
create table if not exists public.shop_foreman_settings (
  id                  uuid        primary key default gen_random_uuid(),
  shop_id             uuid        not null references public.shop_profiles(id) on delete cascade,

  -- The number in E.164 as the customer dials it, and the provider's id for
  -- the same number. Two columns because they are used by different sides: the
  -- first is displayed and the second is what the Vapi API is called with, and
  -- deriving either from the other means a lookup at request time.
  phone_number        text,
  vapi_phone_number_id text,

  -- Off by default. A settings row appearing must never put a live voice agent
  -- on a shop's phone line; switching it on is a deliberate act.
  is_enabled          boolean     not null default false,

  -- Null means "use the built-in copy", as with message_template in 011, so
  -- improving the default greeting does not require rewriting rows that never
  -- customised it.
  greeting            text,

  -- TEXT, not `time`, and this is a considered choice rather than laziness.
  -- These values are round-tripped through an HTML <input type="time">, which
  -- speaks 'HH:MM' strings, and they are handed to the voice agent as part of
  -- a prompt — a string at both ends. Typing them as `time` would add two
  -- conversions and buy no arithmetic, because nothing here subtracts them.
  -- They are also NOT timezone-anchored: they mean local wall-clock time at
  -- the shop, which is the only reading a person setting "we close at 5"
  -- intends.
  working_hours_start text,
  working_hours_end   text,

  -- A day set as text, e.g. 'mon,tue,wed,thu,fri'. Not an array and not seven
  -- booleans: it is written whole by one settings form, read whole by one
  -- prompt builder, and never queried by element.
  working_days        text,

  -- What the agent says outside working_hours. Distinct from greeting so a
  -- shop can be warm during the day and useful at night.
  after_hours_message text,

  -- What the shop does, in prose, injected into the agent's prompt so it can
  -- answer "do you do alignments". Not derived from shop_type: the type gates
  -- which tools the shop may open (lib/permissions.ts), which is a different
  -- question from what it will quote a caller on.
  services_list       text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One settings row per shop — same reasoning as 006 and 011: the settings
-- screen upserts on this, and a second row would leave the agent reading
-- whichever came back first.
create unique index if not exists idx_shop_foreman_settings_shop_id_unique
  on public.shop_foreman_settings(shop_id);

-- The inbound path: a call arrives carrying the provider's phone number id and
-- the webhook has to resolve it to a shop before it can do anything else.
-- Partial, because most shops never buy the add-on and have a null here.
create index if not exists idx_shop_foreman_settings_vapi_phone_number_id
  on public.shop_foreman_settings(vapi_phone_number_id)
  where vapi_phone_number_id is not null;

drop trigger if exists set_shop_foreman_settings_updated_at on public.shop_foreman_settings;
create trigger set_shop_foreman_settings_updated_at
  before update on public.shop_foreman_settings
  for each row execute procedure public.shop_set_updated_at();


-- ============================================================
-- SHOP FOREMAN CALLS
-- One row per answered call.
-- ============================================================
create table if not exists public.shop_foreman_calls (
  id               uuid        primary key default gen_random_uuid(),
  shop_id          uuid        not null references public.shop_profiles(id) on delete cascade,

  -- The provider's id for the call, and the webhook's idempotency key. UNIQUE
  -- across the whole table rather than per shop, because it is unique at the
  -- provider and a call belongs to exactly one shop; the webhook upserts on it
  -- (`on conflict (vapi_call_id) do update`) so a redelivered event updates the
  -- row it already wrote instead of logging the call twice. Nullable for the
  -- rare row entered by hand or backfilled.
  vapi_call_id     text        unique,

  from_number      text,

  -- Provided by the telephony side rather than defaulted to now(): the webhook
  -- fires when the call ENDS, so a default here would record the wrong end of
  -- every conversation. created_at is when we heard about it; started_at is
  -- when it happened. The same separation as signed_at and locked_at in 009.
  started_at       timestamptz,
  ended_at         timestamptz,

  -- Stored rather than computed from the two above, because it is what the
  -- provider billed for and the two can disagree by a second or two at the
  -- edges. When the shop asks "how much talk time did this cost me", this is
  -- the column that answers honestly.
  duration_seconds int,

  transcript       text,
  summary          text,

  -- Free text, deliberately unconstrained. The set of things a phone call can
  -- turn out to be is not knowable in advance and is being learned from what
  -- the agent actually produces; pinning it to a check constraint now would
  -- mean a migration every time a new outcome appears in the wild. If a stable
  -- vocabulary emerges it can be constrained later — that is a cheap ALTER,
  -- whereas an over-tight constraint that starts rejecting webhook payloads
  -- loses call records.
  outcome          text,

  -- SET NULL, both. The call log is a record of a conversation that happened;
  -- voiding the job it produced, or deleting the customer, must not erase it.
  -- Same rule as 009 and 010.
  job_id           uuid        references public.shop_jobs(id)      on delete set null,
  customer_id      uuid        references public.shop_customers(id) on delete set null,

  created_at       timestamptz not null default now()
);

create index if not exists idx_shop_foreman_calls_shop_id
  on public.shop_foreman_calls(shop_id);

-- The call log screen: one shop, most recent first. started_at rather than
-- created_at, because a backfilled batch would otherwise all sort as "now".
create index if not exists idx_shop_foreman_calls_shop_started
  on public.shop_foreman_calls(shop_id, started_at desc);

-- "Has this number called before" — asked while the next call is ringing.
create index if not exists idx_shop_foreman_calls_from_number
  on public.shop_foreman_calls(shop_id, from_number)
  where from_number is not null;

create index if not exists idx_shop_foreman_calls_job_id
  on public.shop_foreman_calls(job_id)
  where job_id is not null;

create index if not exists idx_shop_foreman_calls_customer_id
  on public.shop_foreman_calls(customer_id)
  where customer_id is not null;

comment on table public.shop_foreman_calls is
  'Foreman AI call log, one row per answered call, written by the Vapi webhook on the service-role key. vapi_call_id is the idempotency key for that upsert. Staff-only read: a transcript is a recording of a customer talking to the shop.';


-- ============================================================
-- ROW LEVEL SECURITY
-- Staff only, on both tables, for all four commands. See the header block.
-- ============================================================
alter table public.shop_foreman_settings enable row level security;
alter table public.shop_foreman_calls    enable row level security;

grant select, insert, update, delete on public.shop_foreman_settings to authenticated;
grant select, insert, update, delete on public.shop_foreman_calls    to authenticated;

revoke all on public.shop_foreman_settings from anon;
revoke all on public.shop_foreman_calls    from anon;


-- ------------------------------------------------------------
-- SHOP FOREMAN SETTINGS
-- ------------------------------------------------------------
drop policy if exists "shop_foreman_settings: select by staff" on public.shop_foreman_settings;
create policy "shop_foreman_settings: select by staff"
  on public.shop_foreman_settings for select
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_foreman_settings: insert by staff" on public.shop_foreman_settings;
create policy "shop_foreman_settings: insert by staff"
  on public.shop_foreman_settings for insert
  to authenticated
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_foreman_settings: update by staff" on public.shop_foreman_settings;
create policy "shop_foreman_settings: update by staff"
  on public.shop_foreman_settings for update
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff())
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_foreman_settings: delete by staff" on public.shop_foreman_settings;
create policy "shop_foreman_settings: delete by staff"
  on public.shop_foreman_settings for delete
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff());


-- ------------------------------------------------------------
-- SHOP FOREMAN CALLS
-- ------------------------------------------------------------
drop policy if exists "shop_foreman_calls: select by staff" on public.shop_foreman_calls;
create policy "shop_foreman_calls: select by staff"
  on public.shop_foreman_calls for select
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_foreman_calls: insert by staff" on public.shop_foreman_calls;
create policy "shop_foreman_calls: insert by staff"
  on public.shop_foreman_calls for insert
  to authenticated
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_foreman_calls: update by staff" on public.shop_foreman_calls;
create policy "shop_foreman_calls: update by staff"
  on public.shop_foreman_calls for update
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff())
  with check (shop_id = public.shop_current_shop_id() and public.shop_is_staff());

drop policy if exists "shop_foreman_calls: delete by staff" on public.shop_foreman_calls;
create policy "shop_foreman_calls: delete by staff"
  on public.shop_foreman_calls for delete
  to authenticated
  using (shop_id = public.shop_current_shop_id() and public.shop_is_staff());


-- ============================================================
-- VERIFICATION, POST-APPLY
--
-- Both tables present with RLS on:
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public'
--      and tablename in ('shop_foreman_settings', 'shop_foreman_calls');
--
-- Eight policies, four on each, every one carrying shop_is_staff():
--   select tablename, policyname, cmd, qual, with_check from pg_policies
--    where schemaname = 'public'
--      and tablename in ('shop_foreman_settings', 'shop_foreman_calls')
--    order by tablename, cmd;
--
-- One settings row per shop — the second insert must fail:
--   begin;
--   insert into public.shop_foreman_settings (shop_id) values ('<a real shop id>');
--   insert into public.shop_foreman_settings (shop_id) values ('<a real shop id>');
--   rollback;
--
-- A new settings row is switched OFF:
--   begin;
--   insert into public.shop_foreman_settings (shop_id)
--     values ('<a real shop id>') returning is_enabled;
--   rollback;
--
-- vapi_call_id dedupes the webhook — the second insert must fail:
--   begin;
--   insert into public.shop_foreman_calls (shop_id, vapi_call_id)
--     values ('<a real shop id>', 'call-1');
--   insert into public.shop_foreman_calls (shop_id, vapi_call_id)
--     values ('<a real shop id>', 'call-1');
--   rollback;
--
-- ...but two calls with no provider id are still allowed (unique ignores
-- nulls), which is what makes hand-entered rows possible:
--   begin;
--   insert into public.shop_foreman_calls (shop_id) values ('<a real shop id>');
--   insert into public.shop_foreman_calls (shop_id) values ('<a real shop id>');
--   rollback;
--
-- job_id and customer_id are SET NULL (confdeltype = 'n'), shop_id is CASCADE:
--   select conname, confdeltype
--     from pg_constraint
--    where conrelid = 'public.shop_foreman_calls'::regclass
--      and contype  = 'f'
--    order by conname;
--
-- With the anon key, both must return [] or an error — a leak here is a leak
-- of customer call transcripts:
--   GET /rest/v1/shop_foreman_calls?select=transcript
--   GET /rest/v1/shop_foreman_settings?select=phone_number
--
-- And with a TECH's session token, both must also come back empty:
--   select count(*) from public.shop_foreman_calls;    -- 0 for a tech
--   select count(*) from public.shop_foreman_settings; -- 0 for a tech
-- ============================================================

-- ============================================================
-- END OF MIGRATION 013
-- ============================================================

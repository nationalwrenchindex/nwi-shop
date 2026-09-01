-- ============================================================
-- NWI Shop
-- Migration: 015_shop_profiles_fields.sql
-- Three form-defaults on shop_profiles: epa_cert_number, tech_name,
-- google_place_id.
-- Run this entire file in your Supabase SQL Editor, after 014.
-- ============================================================
--
-- An ALTER against a live, populated table, like 008 and 014. All three
-- columns are nullable with no default, so nothing is backfilled and no
-- existing row changes meaning: a shop that has not entered an EPA number has
-- a null one, which is the truth.
--
-- WHAT WAS CHECKED BEFORE WRITING THIS FILE.
--
-- 001 already ships shop_profiles with id, owner_id, business_name, logo_url,
-- address, city, state, zip, phone, email, tax_rate, labor_rate,
-- subscription_tier, created_at and updated_at; 008 added shop_type. In
-- particular LOGO_URL ALREADY EXISTS and is NOT re-added here — the letterhead
-- on every PDF this schema produces reads that column from 001. Nothing below
-- duplicates anything already on the table.
--
-- These three are shop-level DEFAULTS, not authoritative values. Each one is
-- copied onto a document at the moment the document is created, and the copy
-- on the document is what counts from then on. Editing the profile changes
-- what the next form pre-fills; it does not and must not rewrite paperwork
-- already signed.
-- ============================================================


-- ------------------------------------------------------------
-- The shop's EPA Section 608 certification number.
--
-- Pre-fills shop_epa_log.tech_certification_number (010). The log column is
-- the one that counts: 40 CFR Part 82 asks which CERTIFIED PERSON handled the
-- refrigerant, and in a shop with several certified techs the answer differs
-- per entry. This column is the default for the common case — a one- or
-- two-person shop where it is the same number every time — and saves it being
-- typed on every event.
--
-- No format constraint. Certification numbers are issued by several
-- EPA-approved certifying organisations in formats that are not ours to
-- predict, and a regex here would reject a valid number from a body we had not
-- seen.
-- ------------------------------------------------------------
alter table public.shop_profiles
  add column if not exists epa_cert_number text;


-- ------------------------------------------------------------
-- The default inspector / signer name.
--
-- Pre-fills shop_inspections.inspector_name (009), which is NOT NULL because
-- the federal form has a box for it. This is emphatically NOT a replacement
-- for shop_techs — a shop has many techs and they live on their own table with
-- their own roles and their own logins. It exists because the smallest shops
-- on this product are one person who is the owner, the manager and the only
-- tech, and making that person add themselves to a roster before they can sign
-- an inspection is a signup step that earns nothing.
--
-- Precedence, and it matters: an inspection signed by a logged-in tech takes
-- that tech's name and sets inspector_tech_id. This column is the fallback
-- when there is no tech row to read — never an override of one.
-- ------------------------------------------------------------
alter table public.shop_profiles
  add column if not exists tech_name text;


-- ------------------------------------------------------------
-- The shop's Google Place id — its listing, for review links.
--
-- THIS OVERLAPS shop_review_settings.google_place_id (011) AND THE OVERLAP IS
-- INTENTIONAL. They are not the same fact:
--
--   shop_profiles.google_place_id       the shop's own listing. Part of its
--                                       identity, alongside address and phone.
--                                       Useful with TorqueWrench switched off
--                                       — a "find us on Google" link, a map.
--   shop_review_settings.google_place_id  where TorqueWrench sends a happy
--                                       customer. Usually the same listing;
--                                       occasionally a different one, for a
--                                       shop with several locations under one
--                                       account or a franchise pointing
--                                       reviews at the parent listing.
--
-- The resolution rule is one line and belongs in exactly one helper:
-- TorqueWrench reads the settings column and falls back to this one when it is
-- null. Do not "tidy up" the duplication by deleting either column without
-- deciding first which of the two questions the survivor answers.
-- ------------------------------------------------------------
alter table public.shop_profiles
  add column if not exists google_place_id text;


comment on column public.shop_profiles.epa_cert_number is
  'Shop-level default EPA 608 certification number. Pre-fills shop_epa_log.tech_certification_number; the value recorded on the log entry is the authoritative one.';

comment on column public.shop_profiles.tech_name is
  'Default inspector/signer name, pre-filling shop_inspections.inspector_name for one-person shops. Not a substitute for shop_techs — a logged-in tech''s own name always wins.';

comment on column public.shop_profiles.google_place_id is
  'The shop''s own Google listing. shop_review_settings.google_place_id (011) is TorqueWrench''s override; the sender reads that one and falls back to this.';


-- ============================================================
-- NO INDEXES
--
-- Deliberately none, and worth stating so nobody adds one out of habit. All
-- three columns are read only as part of a shop_profiles row the caller has
-- already fetched by id — the profile is loaded once per session and these
-- ride along. Nothing filters, joins or sorts on them, and an index that
-- serves no query is a write cost with no reader.
--
-- Note the contrast with 008, which DID index shop_type: that column is
-- aggregated across the whole table by the admin pages ("how many HD shops
-- signed up this month"), a query with no shop_id to narrow it. These three
-- have no such access path.
-- ============================================================


-- ============================================================
-- ROW LEVEL SECURITY — NO CHANGE NEEDED
--
-- The same note as 008 and 014. The four shop_profiles policies in 007
-- ("select own shop", "insert own", "update by manager", "delete by owner")
-- gate whole rows; every column of a row a caller may read is already covered,
-- including columns added afterwards. These three need no policy and this file
-- adds none.
--
-- All three are readable by anyone in the shop, including techs, and that is
-- correct: an EPA certification number is printed on the log, the signer's
-- name is printed on the inspection, and a Google Place id is a public
-- identifier for a public listing. None of them is a secret from the people
-- who work there.
-- ============================================================


-- ============================================================
-- VERIFICATION, POST-APPLY
--
-- All three columns exist and all three are nullable:
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name   = 'shop_profiles'
--      and column_name in ('epa_cert_number', 'tech_name', 'google_place_id')
--    order by column_name;
--
-- logo_url is still the one column from 001 — exactly one row, and it must NOT
-- have been re-added or altered by this file:
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name   = 'shop_profiles'
--      and column_name  = 'logo_url';
--
-- Nothing was backfilled — all three counts are 0:
--   select count(*) filter (where epa_cert_number is not null) as epa,
--          count(*) filter (where tech_name       is not null) as tech,
--          count(*) filter (where google_place_id is not null) as place
--     from public.shop_profiles;
--
-- The full column list, for a last read-through against ShopProfile in
-- lib/types.ts:
--   select ordinal_position, column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'shop_profiles'
--    order by ordinal_position;
--
-- Policy count on shop_profiles unchanged at 4:
--   select count(*) from pg_policies
--    where schemaname = 'public' and tablename = 'shop_profiles';
--
-- And no index was added — this must return only the indexes from 001 and 008
-- (idx_shop_profiles_owner_id, idx_shop_profiles_shop_type, and the primary
-- key):
--   select indexname from pg_indexes
--    where schemaname = 'public' and tablename = 'shop_profiles'
--    order by indexname;
-- ============================================================

-- ============================================================
-- END OF MIGRATION 015
-- ============================================================

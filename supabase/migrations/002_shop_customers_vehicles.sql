-- ============================================================
-- NWI Shop
-- Migration: 002_shop_customers_vehicles.sql
-- The shop's customer roster and the vehicles those customers bring in.
-- Run this entire file in your Supabase SQL Editor, after 001.
-- ============================================================


-- ============================================================
-- SHOP CUSTOMERS
-- Scoped to the shop, not to a user: every tech on the floor works the same
-- roster, so shop_id is the ownership column here and everywhere below.
-- ============================================================
create table if not exists public.shop_customers (
  id         uuid        primary key default gen_random_uuid(),
  shop_id    uuid        not null references public.shop_profiles(id) on delete cascade,
  first_name text        not null,
  last_name  text        not null,
  company    text,
  email      text,
  phone      text,
  address    text,
  city       text,
  state      text,
  zip        text,
  -- SUPPRESSION flags, not consent flags — the same modelling the sibling
  -- project settled on in its migration 117. Both default false so adding a
  -- customer never silently disables the shop's reminders and invoices for
  -- them; suppression exists only because a human explicitly set it.
  no_sms     boolean     not null default false,
  no_email   boolean     not null default false,
  notes      text,
  created_at timestamptz not null default now()
);

create index if not exists idx_shop_customers_shop_id on public.shop_customers(shop_id);
-- Serves the customer search box: "Smith" typed into a shop of a few thousand.
create index if not exists idx_shop_customers_shop_last_name
  on public.shop_customers(shop_id, last_name);


-- ============================================================
-- SHOP VEHICLES
-- A vehicle always belongs to a customer (customer_id is NOT NULL, matching
-- ShopVehicle.customer_id: string in lib/types.ts) and carries shop_id
-- directly so every RLS policy in this schema is the same one-column check
-- rather than a join.
-- unit_number is the fleet customer's own asset number — the thing a fleet
-- dispatcher says on the phone instead of a VIN.
-- ============================================================
create table if not exists public.shop_vehicles (
  id          uuid        primary key default gen_random_uuid(),
  shop_id     uuid        not null references public.shop_profiles(id) on delete cascade,
  customer_id uuid        not null references public.shop_customers(id) on delete cascade,
  year        integer,
  make        text,
  model       text,
  vin         text,
  engine      text,
  mileage     integer,
  color       text,
  unit_number text,
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_shop_vehicles_shop_id     on public.shop_vehicles(shop_id);
create index if not exists idx_shop_vehicles_customer_id on public.shop_vehicles(customer_id);
-- VIN lookup at the counter. Not unique: two shops may service the same truck,
-- and a partially-entered VIN is better stored than rejected.
create index if not exists idx_shop_vehicles_shop_vin
  on public.shop_vehicles(shop_id, vin)
  where vin is not null;


-- ============================================================
-- ROW LEVEL SECURITY — enabled here, policies in 007
-- ============================================================
alter table public.shop_customers enable row level security;
alter table public.shop_vehicles  enable row level security;

-- ============================================================
-- END OF MIGRATION 002
-- ============================================================

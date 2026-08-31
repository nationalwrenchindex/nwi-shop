-- ============================================================
-- NWI Shop
-- Migration: 005_shop_inventory.sql
-- Parts on the shelf, parts on the truck, and every movement between them.
-- Run this entire file in your Supabase SQL Editor, after 004.
-- ============================================================


-- ============================================================
-- SHOP INVENTORY
-- One row per part per LOCATION. `location` splits the shelf stock from the
-- stock riding around on a mobile unit, and the same part number legitimately
-- exists in both with different counts -- which is exactly why the unique
-- constraint below is on three columns and not two.
-- ============================================================
create table if not exists public.shop_inventory (
  id               uuid        primary key default gen_random_uuid(),
  shop_id          uuid        not null references public.shop_profiles(id) on delete cascade,
  location         text        not null check (location in ('shop', 'vehicle')),
  part_number      text        not null,
  description      text        not null,
  manufacturer     text,
  -- numeric, not integer: fluids, sealant and wire are counted in quarts,
  -- ounces and feet.
  quantity_on_hand numeric     not null default 0,
  reorder_point    numeric     not null default 0,
  unit_cost        numeric     not null default 0,
  unit_price       numeric     not null default 0,
  vendor           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- A part number means one stock line per location within a shop. Receiving
-- against an existing part must update that row, not create a second one --
-- two rows for the same part is how a count silently goes wrong.
create unique index if not exists idx_shop_inventory_shop_part_location
  on public.shop_inventory(shop_id, part_number, location);

create index if not exists idx_shop_inventory_shop_id on public.shop_inventory(shop_id);
-- The reorder report: what has dropped to or below its trigger point.
create index if not exists idx_shop_inventory_reorder
  on public.shop_inventory(shop_id)
  where quantity_on_hand <= reorder_point;

drop trigger if exists set_shop_inventory_updated_at on public.shop_inventory;
create trigger set_shop_inventory_updated_at
  before update on public.shop_inventory
  for each row execute procedure public.shop_set_updated_at();


-- ------------------------------------------------------------
-- LINE ITEM -> INVENTORY
-- The column was created in 003; the constraint waited for this table.
-- SET NULL: writing a part off the shelf and later deleting that stock line
-- must not delete the invoice line that billed the customer for it.
-- ------------------------------------------------------------
alter table public.shop_job_line_items
  drop constraint if exists shop_job_line_items_inventory_id_fkey;
alter table public.shop_job_line_items
  add constraint shop_job_line_items_inventory_id_fkey
  foreign key (inventory_id) references public.shop_inventory(id) on delete set null;

create index if not exists idx_shop_job_line_items_inventory_id
  on public.shop_job_line_items(inventory_id)
  where inventory_id is not null;


-- ============================================================
-- SHOP INVENTORY TRANSACTIONS
-- The append-only ledger behind shop_inventory.quantity_on_hand. Every change
-- to a count should land here, so the question "why does the computer say
-- four and the shelf say two" always has an answer with a name and a time on
-- it.
--
--   received -- stock arrived from a vendor        (quantity positive)
--   used     -- pulled for a job                   (quantity negative)
--   adjusted -- physical count correction          (either sign)
--   returned -- went back to the vendor or shelf   (either sign)
--
-- `quantity` carries its own sign rather than being made positive with the
-- type deciding direction: an adjustment can go either way, and a ledger you
-- can sum straight to the on-hand figure is a ledger you can check.
-- ============================================================
create table if not exists public.shop_inventory_transactions (
  id           uuid        primary key default gen_random_uuid(),
  shop_id      uuid        not null references public.shop_profiles(id)  on delete cascade,
  inventory_id uuid        not null references public.shop_inventory(id) on delete cascade,
  job_id       uuid        references public.shop_jobs(id)  on delete set null,
  tech_id      uuid        references public.shop_techs(id) on delete set null,
  type         text        not null check (type in ('received', 'used', 'adjusted', 'returned')),
  quantity     numeric     not null,
  cost         numeric     not null default 0,
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_shop_inventory_transactions_shop_id
  on public.shop_inventory_transactions(shop_id);
create index if not exists idx_shop_inventory_transactions_inventory_id
  on public.shop_inventory_transactions(inventory_id);
create index if not exists idx_shop_inventory_transactions_job_id
  on public.shop_inventory_transactions(job_id);
create index if not exists idx_shop_inventory_transactions_tech_id
  on public.shop_inventory_transactions(tech_id);
-- The parts-history panel on one stock line, newest first.
create index if not exists idx_shop_inventory_transactions_inv_created
  on public.shop_inventory_transactions(inventory_id, created_at desc);


-- ============================================================
-- ROW LEVEL SECURITY -- enabled here, policies in 007
-- ============================================================
alter table public.shop_inventory              enable row level security;
alter table public.shop_inventory_transactions enable row level security;

-- ============================================================
-- END OF MIGRATION 005
-- ============================================================

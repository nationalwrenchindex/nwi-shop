# NWI Shop — database migrations

These are applied by hand: open the Supabase SQL editor, paste one file in, run it, move to the next.

## Apply order

| # | File | What it creates |
|---|------|-----------------|
| 1 | `001_shop_core.sql` | `shop_profiles`, `shop_techs`, the `shop_set_updated_at()` trigger function |
| 2 | `002_shop_customers_vehicles.sql` | `shop_customers`, `shop_vehicles` |
| 3 | `003_shop_bays_jobs.sql` | `shop_bays`, `shop_jobs`, `shop_job_line_items`, per-shop job numbering |
| 4 | `004_shop_timeclock.sql` | `shop_timeclock` + the one-open-punch-per-tech-per-type index |
| 5 | `005_shop_inventory.sql` | `shop_inventory`, `shop_inventory_transactions` |
| 6 | `006_shop_subscriptions.sql` | `shop_subscriptions`, `get_charter_slots_remaining()` |
| 7 | `007_shop_rls.sql` | RLS helper functions, `shop_techs_safe`, grants, all 44 policies |
| 8 | `008_shop_type.sql` | `shop_profiles.shop_type` (`ld` / `hd` / `full_service`) + its check constraint and index |

The order is not optional. Later files add foreign keys to tables the earlier ones create, and two constraints are deliberately deferred: `shop_bays.current_job_id → shop_jobs` is added at the end of 003, and `shop_job_line_items.inventory_id → shop_inventory` is added in 005.

Each file is idempotent enough to re-run: `create table if not exists`, `create index if not exists`, `create or replace function`, and `drop … if exists` before every trigger, view and policy.

## Notes

- **Shared project.** These tables live in the same Supabase project as the National Wrench Index mobile-mechanic app. Every object here is `shop_`-prefixed so nothing collides — including the trigger function, which is `shop_set_updated_at()` and not the existing `set_updated_at()`.
- **RLS is enabled in files 001–006, with the policies in 007.** So if you stop halfway the tables are closed, not open.
- **`pay_rate` is not protected by RLS.** Postgres RLS is row-level and cannot hide a column from a foreman who is allowed to read the row. Concealment is enforced by `lib/permissions.ts` and by the `shop_techs_safe` view. The full explanation is in the header block of 007.
- **`get_charter_slots_remaining()` is callable by `anon`** — the public landing page calls it with no session. It returns only an integer and exposes no subscription rows.

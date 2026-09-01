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
| 9 | `009_shop_inspections.sql` | `shop_inspections` — DOT and aerial in one table, discriminated by `type` |
| 10 | `010_shop_epa_log.sql` | `shop_epa_log` — the EPA 608 refrigerant log |
| 11 | `011_shop_reviews.sql` | `shop_review_requests` (one per job), `shop_review_settings` (one per shop) |
| 12 | `012_shop_social_posts.sql` | `shop_social_posts` — AI-drafted content held for approval |
| 13 | `013_shop_foreman.sql` | `shop_foreman_settings`, `shop_foreman_calls` |
| 14 | `014_shop_jobs_invoicing.sql` | Invoice + NWI Garage sync columns on `shop_jobs`, with the two unique indexes |
| 15 | `015_shop_profiles_fields.sql` | `shop_profiles.epa_cert_number`, `.tech_name`, `.google_place_id` |

The order is not optional. Later files add foreign keys to tables the earlier ones create, and two constraints are deliberately deferred: `shop_bays.current_job_id → shop_jobs` is added at the end of 003, and `shop_job_line_items.inventory_id → shop_inventory` is added in 005.

Each file is idempotent enough to re-run: `create table if not exists`, `create index if not exists`, `create or replace function`, and `drop … if exists` before every trigger, view and policy.

## Notes

- **Shared project.** These tables live in the same Supabase project as the National Wrench Index mobile-mechanic app. Every object here is `shop_`-prefixed so nothing collides — including the trigger function, which is `shop_set_updated_at()` and not the existing `set_updated_at()`.
- **RLS is enabled in files 001–006, with the policies in 007.** So if you stop halfway the tables are closed, not open.
- **From 009 on, each file carries its own policies.** 001–006 deferred theirs to 007 because they were written as one batch. A table added afterwards enables RLS *and* creates its policies in the same file — otherwise it sits with RLS on and zero policies, denying everything, until somebody remembers to go back and edit 007. Files 014 and 015 add no policies at all, and say so: they only ALTER tables whose existing row policies already cover every column.
- **Compliance rows outlive what they hang off.** `shop_inspections` and `shop_epa_log` reference jobs, vehicles, customers and techs with `on delete set null`, never `cascade` — a signed inspection or a refrigerant entry is evidence, and voiding the work order it was found on must not erase it. The one deliberate exception is `shop_review_requests.job_id`, which *is* `cascade`: that row is a queue entry for a specific job, not a record of anything that happened.
- **Two things are enforced by a unique index rather than by application code.** One review request per job (`idx_shop_review_requests_job_id_unique`), because a select-then-insert dedupe loses the race against a retrying webhook and the customer gets two texts; and one invoice number per shop (`idx_shop_jobs_shop_invoice_number_unique`), partial on `is not null`.
- **`shop_jobs.invoice_public_token` must never get an `anon` policy.** The public invoice page is a service-role server route that resolves the token itself. An RLS policy cannot see the token the visitor typed — it evaluates against rows — so any policy permissive enough to let the page work would expose every invoiced job in the system. The full explanation is in the header of 014.
- **`pay_rate` is not protected by RLS.** Postgres RLS is row-level and cannot hide a column from a foreman who is allowed to read the row. Concealment is enforced by `lib/permissions.ts` and by the `shop_techs_safe` view. The full explanation is in the header block of 007.
- **`get_charter_slots_remaining()` is callable by `anon`** — the public landing page calls it with no session. It returns only an integer and exposes no subscription rows.

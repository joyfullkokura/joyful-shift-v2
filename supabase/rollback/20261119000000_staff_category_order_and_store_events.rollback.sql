-- Rollback for migration G (20261119000000_staff_category_order_and_store_events.sql).
-- NOT a migration: run manually only after the app has been reverted to the
-- version without categories. Categories, order, the deadline and all events are lost.

begin;

drop table if exists public.store_day_events;
alter table public.staff drop constraint if exists staff_category_check;
alter table public.staff drop column if exists category, drop column if exists display_order;
alter table public.stores drop constraint if exists stores_request_deadline_day_check;
alter table public.stores drop column if exists request_deadline_day;

commit;

notify pgrst, 'reload schema';

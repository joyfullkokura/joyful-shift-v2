-- Rollback for migration C (20261116000000_shift_requests_unique_and_parse_status.sql).
-- NOT a migration: run manually only after the app has been reverted to the
-- version that saves requests with delete + insert (the upsert version needs
-- the constraint). Dropping the columns discards the analysis state only;
-- parsed_request itself is kept.

begin;

alter table public.shift_requests drop constraint if exists shift_requests_store_staff_date_key;
alter table public.shift_requests
  drop column if exists parse_error,
  drop column if exists parsed_at;

commit;

notify pgrst, 'reload schema';

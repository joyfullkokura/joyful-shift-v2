-- Rollback for migration D (20261117000000_structured_shift_requests.sql).
-- NOT a migration: run manually only after the app has been reverted to the
-- version without request_kind. Day-off rows keep is_off, so 休み survives;
-- time requests chosen on screen are lost (their memo is kept).
-- start_time / end_time are NOT dropped: they may predate migration D.

begin;

alter table public.shift_requests drop constraint if exists shift_requests_request_kind_check;
alter table public.shift_requests drop column if exists request_kind;

commit;

notify pgrst, 'reload schema';

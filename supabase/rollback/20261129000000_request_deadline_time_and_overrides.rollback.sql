-- Rollback of Migration I. Deploy the previous app version FIRST (it does not
-- read these columns). Drops the per-month overrides and the deadline time.

begin;

drop table if exists public.store_request_deadline_overrides;

alter table public.stores
  drop column if exists request_deadline_updated_at,
  drop column if exists request_deadline_updated_by,
  drop column if exists request_deadline_time;

comment on column public.stores.request_deadline_day is '前月〇日: day of the previous month when requests are due (display only).';

commit;

notify pgrst, 'reload schema';

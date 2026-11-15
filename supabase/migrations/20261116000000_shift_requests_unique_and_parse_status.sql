-- Migration C: one request row per staff member and day, plus the state of its AI analysis.
--
-- Prerequisite (checked on 2026-11-15 in production): no duplicate
-- (store_id, staff_id, date) rows and no nulls in those columns. Re-run the
-- duplicate query in section 7 of supabase/checks/privileges_and_dependencies.sql
-- first if time has passed; adding the constraint fails if any duplicate exists.
--
-- Additive only. Apply BEFORE deploying the app version that saves requests with
-- an upsert (it relies on this constraint as its ON CONFLICT target).

begin;

-- Lets saving a month upsert by day instead of delete + insert, so the cached
-- parsed_request of an unchanged memo survives a re-save.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.shift_requests'::regclass
       and conname = 'shift_requests_store_staff_date_key'
  ) then
    alter table public.shift_requests
      add constraint shift_requests_store_staff_date_key unique (store_id, staff_id, date);
  end if;
end
$$;

-- Analysis state for the memo of a request:
--   parsed_request set                      -> analysed (parsed_at = when)
--   parsed_request null, parse_error set    -> last attempt failed (retried later)
--   parsed_request null, parse_error null   -> not analysed yet
alter table public.shift_requests
  add column if not exists parse_error text,
  add column if not exists parsed_at timestamptz;

comment on column public.shift_requests.parse_error is 'Short reason of the last failed AI analysis of memo (no memo content). Null after success or a memo change.';
comment on column public.shift_requests.parsed_at is 'When parsed_request was written by the AI analysis.';

-- RLS stays deny-all (no policies). Browser roles get nothing; the server
-- (service role) is granted explicitly, which also covers the new columns.
alter table public.shift_requests enable row level security;
revoke all on table public.shift_requests from anon, authenticated;
grant select, insert, update, delete on table public.shift_requests to service_role;

commit;

notify pgrst, 'reload schema';

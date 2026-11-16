-- Migration D: day requests are chosen on screen (休み / 終日OK / 〇時から / 〇時まで /
-- 時間を指定) and stored as structured data. The memo stays as a note for the
-- manager only; shift generation no longer reads it (no AI analysis).
--
-- request_kind
--   off    -> 休み (is_off is kept equal to request_kind = 'off' for older readers)
--   any    -> 終日OK: the whole business day, even outside the usual conditions
--   from   -> start_time .. closing time
--   until  -> opening time .. end_time
--   range  -> start_time .. end_time
--   none   -> 希望なし (only a memo for the manager): the usual conditions apply
--   null   -> legacy row saved before this migration; converted by the app
--             (rules on the memo) or confirmed by the manager on the generate screen.
--
-- Additive only. Apply BEFORE deploying the app version that saves request_kind.

begin;

alter table public.shift_requests
  add column if not exists request_kind text,
  add column if not exists start_time time,
  add column if not exists end_time time;

-- start_time / end_time may already exist from an early version of the app.
-- The app reads them as HH:MM[:SS] text; refuse anything else instead of guessing.
do $$
declare
  column_type text;
begin
  for column_type in
    select data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'shift_requests' and column_name in ('start_time', 'end_time')
  loop
    if column_type not in ('time without time zone', 'text', 'character varying') then
      raise exception 'shift_requests start_time / end_time has unexpected type %', column_type;
    end if;
  end loop;
end
$$;

-- Existing day-off rows are already structured (rows that also carry old times
-- are left to the app, which keeps "off" and clears the times when it converts them).
update public.shift_requests set request_kind = 'off'
 where is_off is true and request_kind is null and start_time is null and end_time is null;

alter table public.shift_requests drop constraint if exists shift_requests_request_kind_check;
alter table public.shift_requests add constraint shift_requests_request_kind_check check (
  request_kind is null
  or (request_kind in ('off', 'any', 'none') and start_time is null and end_time is null)
  or (request_kind = 'from' and start_time is not null and end_time is null)
  or (request_kind = 'until' and start_time is null and end_time is not null)
  or (request_kind = 'range' and start_time is not null and end_time is not null)
);

comment on column public.shift_requests.request_kind is 'off / any / from / until / range / none, chosen on screen. Null = legacy memo-only row (converted by rules or confirmed by the manager).';
comment on column public.shift_requests.memo is 'Note for the manager. Not used by shift generation.';

-- RLS stays deny-all (no policies); only the server (service role) reads / writes.
alter table public.shift_requests enable row level security;
revoke all on table public.shift_requests from anon, authenticated;
grant select, insert, update, delete on table public.shift_requests to service_role;

commit;

notify pgrst, 'reload schema';

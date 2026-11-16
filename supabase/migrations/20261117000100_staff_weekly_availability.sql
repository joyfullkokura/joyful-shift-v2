-- Migration E: usual availability per weekday, chosen on screen (出られない /
-- 終日OK / 〇時から / 〇時まで / 時間を指定) at first-time setup, registration,
-- condition change requests and in the roster. Replaces the AI analysis of the
-- working-conditions memo.
--
-- weekly_availability: {"monday": {"kind": "from", "start": "17:00", "end": null}, ...}
--   (all seven days; kind off / any / from / until / range). Null = not set yet:
--   shift generation keeps using work_start_1 / work_end_1 / work_start_2 / work_end_2.
-- parsed_conditions keeps being written (derived from weekly_availability) for
-- the existing displays.
--
-- Additive only. Apply together with migration D, before deploying the app.

begin;

alter table public.staff add column if not exists weekly_availability jsonb;

alter table public.staff drop constraint if exists staff_weekly_availability_shape_check;
alter table public.staff add constraint staff_weekly_availability_shape_check check (
  weekly_availability is null
  or (jsonb_typeof(weekly_availability) = 'object'
      and weekly_availability ?& array['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
);

comment on column public.staff.weekly_availability is 'Usual availability per weekday chosen on screen. Null = not set (work_start_* apply). Validated by the app.';

-- RLS stays deny-all (no policies); only the server (service role) reads / writes.
-- Column-level SELECT may have been restricted on staff by migration A-post, so
-- grant the new column explicitly as well as the table.
alter table public.staff enable row level security;
revoke all on table public.staff from anon, authenticated;
grant select, insert, update, delete on table public.staff to service_role;
grant select (weekly_availability), insert (weekly_availability), update (weekly_availability) on table public.staff to service_role;

commit;

notify pgrst, 'reload schema';

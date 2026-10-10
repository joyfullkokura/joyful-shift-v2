-- Values collected during a staff member's first PIN setup.
alter table public.staff
  add column if not exists employment_type text,
  add column if not exists work_start_1 time,
  add column if not exists work_end_1 time,
  add column if not exists work_start_2 time,
  add column if not exists work_end_2 time;

comment on column public.staff.employment_type is 'Staff-selected employment category, such as student part-time or freeter.';
comment on column public.staff.work_start_1 is 'Primary availability start time selected by staff.';
comment on column public.staff.work_end_1 is 'Primary availability end time selected by staff.';
comment on column public.staff.work_start_2 is 'Secondary, lower-priority availability start time selected by staff.';
comment on column public.staff.work_end_2 is 'Secondary, lower-priority availability end time selected by staff.';

-- Rollback for migration E (20261117000100_staff_weekly_availability.sql).
-- NOT a migration: run manually only after the app has been reverted to the
-- version without weekly availability. The weekday choices are lost;
-- parsed_conditions (derived from them) and work_start_* stay as they are.

begin;

alter table public.staff drop constraint if exists staff_weekly_availability_shape_check;
alter table public.staff drop column if exists weekly_availability;

commit;

notify pgrst, 'reload schema';

-- Rollback for migration H (20261126000000_labor_rules_and_productivity.sql).
-- NOT a migration: run manually only after the app has been reverted to the version
-- without labor rules. Flags, caps, rule settings, expected sales, curves and hourly sales are lost.

begin;

drop table if exists public.store_hourly_sales;
alter table public.generation_settings drop constraint if exists generation_settings_expected_sales_check;
alter table public.generation_settings drop column if exists expected_sales, drop column if exists required_curve;
alter table public.stores drop constraint if exists stores_labor_rules_check;
alter table public.stores
  drop column if exists labor_time_mode, drop column if exists daily_max_hours, drop column if exists weekly_max_hours,
  drop column if exists min_shift_hours, drop column if exists rest_interval_hours, drop column if exists late_night_start,
  drop column if exists late_night_end, drop column if exists week_start_day, drop column if exists check_lead,
  drop column if exists check_open_close, drop column if exists novice_rank_floor, drop column if exists novice_rule,
  drop column if exists apply_weekly_20h_line, drop column if exists target_sales_per_labor_hour, drop column if exists sales_offset_hours;
alter table public.staff drop constraint if exists staff_hour_caps_check;
alter table public.staff
  drop column if exists is_minor, drop column if exists flags_confirmed_at, drop column if exists can_lead,
  drop column if exists can_open, drop column if exists can_close, drop column if exists weekly_hour_cap, drop column if exists monthly_hour_cap;

commit;

notify pgrst, 'reload schema';

-- One-off data fix (NOT a migration): rewrites impossible clock times such as
-- "10:00-19:60" in saved schedules to the time they always meant ("10:00-20:00").
-- The generator computed hours from these labels as the next full hour already,
-- so hours and totals do not change; only the text shown on screen / in Excel does.
--
-- 1. Run section 10 of supabase/checks/privileges_and_dependencies.sql first.
-- 2. Run this whole file. It stops (and changes nothing) if anything is left over.

begin;

do $$
declare
  hour_of_day integer;
  remaining integer;
begin
  for hour_of_day in 0..23 loop
    update public.monthly_shifts
       set schedule_data = replace(
             schedule_data::text,
             lpad(hour_of_day::text, 2, '0') || ':60',
             lpad((hour_of_day + 1)::text, 2, '0') || ':00'
           )::jsonb
     where schedule_data::text like '%' || lpad(hour_of_day::text, 2, '0') || ':60%';
  end loop;

  select count(*) into remaining from public.monthly_shifts where schedule_data::text ~ '[0-9]{2}:60';
  if remaining > 0 then
    raise exception '% schedule(s) still contain :60; nothing was changed', remaining;
  end if;
end
$$;

commit;

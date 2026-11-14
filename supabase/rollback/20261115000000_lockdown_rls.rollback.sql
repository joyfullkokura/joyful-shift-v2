-- Emergency rollback for migration B (20261115000000_lockdown_rls.sql).
-- NOT a migration: run manually only if the phase-2 app has to be reverted to
-- the old client-side data access.
--
-- 1. Re-grant the privileges the browser roles had before migration B.
-- 2. Re-create the old policies by running the CREATE POLICY statements saved
--    from section 5 of supabase/checks/privileges_and_dependencies.sql.
-- 3. stores.admin_pw is NOT restored with data (it was an unused plaintext
--    password). It is re-added as a nullable column only so that old code
--    selecting it does not fail.
--
-- This reopens the original vulnerabilities; treat it as a short-lived measure.

begin;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'cleaning_logs', 'config_generation', 'generation_settings', 'monthly_shifts',
    'shift_requests', 'staff', 'staff_requests', 'staff_requirements', 'stores'
  ] loop
    execute format('grant all on table public.%I to anon, authenticated', table_name);
  end loop;
end
$$;

do $$
declare
  sequence_name regclass;
begin
  for sequence_name in
    select c.oid::regclass from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S'
  loop
    execute format('grant usage, select on sequence %s to anon, authenticated', sequence_name);
  end loop;
end
$$;

alter table public.stores add column if not exists admin_pw text;

commit;

-- Then paste and run the saved CREATE POLICY statements here.

notify pgrst, 'reload schema';

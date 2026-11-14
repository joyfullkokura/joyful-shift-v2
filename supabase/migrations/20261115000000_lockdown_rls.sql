-- Migration B: remove the development policies and close the Data API to the
-- browser roles. After this, only the server (service role) reads or writes data.
--
-- !!! APPLY ONLY AFTER the phase-2 app (all reads / writes via Server Actions)
-- is live in production, and after saving the output of section 5 of
-- supabase/checks/privileges_and_dependencies.sql (current policies, for rollback). !!!
--
-- For every public table this
--   * drops every existing policy (the "Enable all access" / "Allow all for
--     development" style policies; names are not hard-coded on purpose),
--   * keeps RLS enabled with no policies, so anon / authenticated match nothing,
--   * revokes all table privileges (and with them all column privileges) from
--     anon and authenticated,
--   * grants DML to service_role explicitly (tables created via SQL no longer
--     receive it automatically).
-- config_generation and staff_requirements are unused by the app and end up
-- fully denied as well.

begin;

do $$
declare
  table_name text;
  policy record;
begin
  foreach table_name in array array[
    'cleaning_logs', 'config_generation', 'generation_settings', 'monthly_shifts',
    'shift_requests', 'staff', 'staff_requests', 'staff_requirements', 'stores'
  ] loop
    for policy in
      select policyname from pg_policies where schemaname = 'public' and tablename = table_name
    loop
      execute format('drop policy %I on public.%I', policy.policyname, table_name);
    end loop;

    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end
$$;

-- serial / nextval() sequences: browser roles lose access, the server keeps it.
do $$
declare
  sequence_name regclass;
begin
  for sequence_name in
    select c.oid::regclass
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S'
  loop
    execute format('revoke all on sequence %s from anon, authenticated', sequence_name);
    execute format('grant usage, select on sequence %s to service_role', sequence_name);
  end loop;
end
$$;

-- Legacy plaintext admin password: unused since the PIN login; never readable again.
-- (Run section 4 of the checks file first: nothing may depend on this column.)
alter table public.stores drop column if exists admin_pw;

commit;

notify pgrst, 'reload schema';

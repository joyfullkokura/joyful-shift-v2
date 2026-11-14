-- Read-only checks. Not a migration: run manually in the SQL editor.

-- 1) The server (service role) must have full DML on every public table it uses.
--    Phase 1 uses staff, staff_requests, stores, auth_throttle; phase 2 uses the rest.
--    Every column must be true.
select c.relname as table_name,
       has_table_privilege('service_role', c.oid, 'SELECT') as can_select,
       has_table_privilege('service_role', c.oid, 'INSERT') as can_insert,
       has_table_privilege('service_role', c.oid, 'UPDATE') as can_update,
       has_table_privilege('service_role', c.oid, 'DELETE') as can_delete,
       c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by 1;

-- 2) serial / nextval() defaults need USAGE on the sequence for inserts
--    (identity columns do not). Every row must be true.
select s.relname as sequence_name,
       has_sequence_privilege('service_role', s.oid, 'USAGE') as can_use
  from pg_class s
  join pg_namespace n on n.oid = s.relnamespace
 where n.nspname = 'public' and s.relkind = 'S'
 order by 1;

-- 3) The lockout function must be executable by the service role only.
select r as role,
       has_function_privilege(r, 'public.auth_register_failure(text, integer, integer, integer[])', 'EXECUTE') as can_execute
  from (values ('service_role'), ('anon'), ('authenticated')) v(r);
-- expected: service_role = true, anon = false, authenticated = false

-- 4) Before migration B drops stores.admin_pw: nothing may depend on it.
--    All three queries must return zero rows (otherwise DROP COLUMN fails or breaks them).
select distinct v.oid::regclass as dependent_view
  from pg_depend d
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class v on v.oid = rw.ev_class
  join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
 where d.refobjid = 'public.stores'::regclass and a.attname = 'admin_pw';

select schemaname, tablename, policyname
  from pg_policies
 where coalesce(qual, '') ilike '%admin_pw%' or coalesce(with_check, '') ilike '%admin_pw%';

select p.oid::regprocedure as function_referencing_admin_pw
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname not in ('pg_catalog', 'information_schema') and p.prosrc ilike '%admin_pw%';

-- 5) BEFORE migration B: save this output somewhere safe. It recreates the
--    current policies if migration B ever has to be rolled back
--    (see supabase/rollback/20261115000000_lockdown_rls.rollback.sql).
select format(
         'create policy %I on %I.%I as %s for %s to %s%s%s;',
         policyname, schemaname, tablename, permissive, cmd,
         array_to_string(roles, ', '),
         case when qual is not null then ' using (' || qual || ')' else '' end,
         case when with_check is not null then ' with check (' || with_check || ')' else '' end
       ) as recreate_statement
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;

-- 6) AFTER migration B: the browser roles must not reach any public table.
--    The first two queries must return zero rows; review the third.
select c.relname as table_still_open, r as role
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace,
       (values ('anon'), ('authenticated')) v(r)
 where n.nspname = 'public' and c.relkind = 'r'
   and (has_table_privilege(r, c.oid, 'SELECT') or has_table_privilege(r, c.oid, 'INSERT')
        or has_table_privilege(r, c.oid, 'UPDATE') or has_table_privilege(r, c.oid, 'DELETE')
        or has_any_column_privilege(r, c.oid, 'SELECT') or has_any_column_privilege(r, c.oid, 'UPDATE'));

select tablename, policyname from pg_policies where schemaname = 'public';

-- Functions in public executable by the browser roles are callable through
-- /rest/v1/rpc. Review anything listed here (it may be a Supabase default you want to keep).
select p.oid::regprocedure as function_name, r as role
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace,
       (values ('anon'), ('authenticated')) v(r)
 where n.nspname = 'public' and has_function_privilege(r, p.oid, 'EXECUTE');

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

-- 7) Migration C (shift_requests one row per staff member and day).
--    BEFORE: must return zero rows (otherwise the unique constraint cannot be added).
select store_id, staff_id, date, count(*) as rows
  from public.shift_requests
 group by store_id, staff_id, date
having count(*) > 1
 order by rows desc
 limit 50;

--    AFTER: the constraint exists, the new columns are there, and only the
--    service role can use them (expected: service_role true / true, others false / false).
select conname from pg_constraint
 where conrelid = 'public.shift_requests'::regclass and conname = 'shift_requests_store_staff_date_key';

select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'shift_requests'
   and column_name in ('parse_error', 'parsed_at');

select r as role,
       has_column_privilege(r, 'public.shift_requests', 'parse_error', 'SELECT')
         and has_column_privilege(r, 'public.shift_requests', 'parsed_at', 'SELECT') as can_select,
       has_column_privilege(r, 'public.shift_requests', 'parse_error', 'UPDATE')
         and has_column_privilege(r, 'public.shift_requests', 'parsed_at', 'UPDATE') as can_update
  from (values ('service_role'), ('anon'), ('authenticated')) v(r);

-- 8) Migration D (structured day requests).
--    BEFORE: shows whether start_time / end_time already exist and with which type
--    (zero rows is fine; the migration adds them as time).
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'shift_requests'
   and column_name in ('start_time', 'end_time', 'request_kind');

--    AFTER: the columns and the check constraint exist, the service role can
--    use the new column (expected: service_role true / true, others false / false),
--    and the breakdown shows how many legacy rows (request_kind null) remain.
select conname from pg_constraint
 where conrelid = 'public.shift_requests'::regclass and conname = 'shift_requests_request_kind_check';

select r as role,
       has_column_privilege(r, 'public.shift_requests', 'request_kind', 'SELECT') as can_select,
       has_column_privilege(r, 'public.shift_requests', 'request_kind', 'UPDATE') as can_update
  from (values ('service_role'), ('anon'), ('authenticated')) v(r);

select coalesce(request_kind, '(legacy)') as request_kind,
       count(*) as rows,
       count(*) filter (where coalesce(trim(memo), '') <> '') as with_memo
  from public.shift_requests
 group by 1
 order by 1;

-- 9) Migration E (weekly availability). AFTER: the column and constraint exist and
--    only the service role can use the column (expected: service_role true / true, others false / false).
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'staff' and column_name = 'weekly_availability';

select conname from pg_constraint
 where conrelid = 'public.staff'::regclass and conname = 'staff_weekly_availability_shape_check';

select r as role,
       has_column_privilege(r, 'public.staff', 'weekly_availability', 'SELECT') as can_select,
       has_column_privilege(r, 'public.staff', 'weekly_availability', 'UPDATE') as can_update
  from (values ('service_role'), ('anon'), ('authenticated')) v(r);

-- 10) Saved schedules containing an impossible clock time such as 10:00-19:60
--     (a display bug of the employee extension before commit "fix(generate): 19:60").
--     The hours were always computed as 20:00, so only the text is wrong.
--     If rows are listed, run supabase/maintenance/20261117_fix_minute_60_shift_labels.sql.
select store_id, target_month, status,
       (length(schedule_data::text) - length(replace(schedule_data::text, ':60', ''))) / 3 as labels_with_60
  from public.monthly_shifts
 where schedule_data::text ~ '[0-9]{2}:60'
 order by target_month desc, store_id;

-- 11) Migration F (one pending condition change per staff member).
--     BEFORE: must return zero rows (otherwise the unique index cannot be created).
select store_id, staff_id, count(*) as pending_requests
  from public.staff_requests
 where type = 'condition_change' and status = 'pending'
 group by store_id, staff_id
having count(*) > 1;

--     AFTER: the index exists and is unique and partial (expected: one row, is_unique = true,
--     the definition ends with WHERE type = 'condition_change' AND status = 'pending').
select i.indexrelid::regclass as index_name, i.indisunique as is_unique, pg_get_indexdef(i.indexrelid) as definition
  from pg_index i
 where i.indexrelid = to_regclass('public.staff_requests_one_pending_condition_change');

-- 12) Migration G (categories, display order, deadline, store events).
--     AFTER: the columns, constraints and table exist; only the service role can use them
--     (expected: service_role all true, anon / authenticated all false).
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'staff' and column_name in ('category', 'display_order'))
     or (table_name = 'stores' and column_name = 'request_deadline_day')
     or table_name = 'store_day_events')
 order by table_name, column_name;

select conname from pg_constraint
 where conname in ('staff_category_check', 'stores_request_deadline_day_check', 'store_day_events_store_id_fkey')
 order by conname;

select r as role,
       has_table_privilege(r, 'public.store_day_events', 'SELECT') as events_select,
       has_table_privilege(r, 'public.store_day_events', 'INSERT') as events_insert,
       has_column_privilege(r, 'public.staff', 'category', 'UPDATE') as staff_category_update,
       has_column_privilege(r, 'public.stores', 'request_deadline_day', 'UPDATE') as stores_deadline_update,
       (select relrowsecurity from pg_class where oid = 'public.store_day_events'::regclass) as events_rls
  from (values ('service_role'), ('anon'), ('authenticated')) v(r);

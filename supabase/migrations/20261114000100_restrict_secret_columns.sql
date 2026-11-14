-- Migration A-post: hide staff.pin_hash / staff.session_version / stores.admin_pw
-- from the anon and authenticated roles.
--
-- !!! APPLY ONLY AFTER the phase-1 app (server-side PIN login) is live in production. !!!
-- The previous client reads pin_hash with the anon key; applying this earlier
-- breaks login on both stores.
--
-- Column-level REVOKE has no effect while a table-level grant exists, so the
-- table-level SELECT / INSERT / UPDATE grants are revoked first and then
-- re-granted column by column, excluding the secret columns. DELETE stays
-- table-level (it is not column-specific). Phase-1 client queries on these
-- tables only use explicit column lists (select('*') moved to the server).
--
-- Columns added to staff / stores later are NOT granted automatically; this is
-- intentional until migration B removes anon access altogether.

begin;

revoke select, insert, update on table public.staff from anon, authenticated;
revoke select, insert, update on table public.stores from anon, authenticated;

do $$
declare
  target record;
  column_list text;
begin
  for target in
    select * from (values
      ('staff',  array['pin_hash', 'session_version']),
      ('stores', array['admin_pw'])
    ) as t(table_name, excluded)
  loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into column_list
      from information_schema.columns
     where table_schema = 'public'
       and table_name = target.table_name
       and column_name <> all (target.excluded);

    execute format(
      'grant select (%1$s), insert (%1$s), update (%1$s) on table public.%2$I to anon, authenticated',
      column_list, target.table_name
    );
  end loop;
end
$$;

commit;

-- Make PostgREST pick up the new privileges immediately.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification (run manually after applying; all six values must be false):
--
-- select r as role, p as privilege,
--        has_column_privilege(r, 'public.staff',  'pin_hash',        p) as staff_pin_hash,
--        has_column_privilege(r, 'public.staff',  'session_version', p) as staff_session_version,
--        has_column_privilege(r, 'public.stores', 'admin_pw',        p) as stores_admin_pw
--   from (values ('anon'), ('authenticated')) a(r),
--        (values ('SELECT'), ('INSERT'), ('UPDATE')) b(p);
--
-- And the app's own columns must still be readable, e.g.:
-- select has_column_privilege('anon', 'public.staff', 'name', 'SELECT');  -- true
-- ---------------------------------------------------------------------------

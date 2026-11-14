-- REFERENCE ONLY - NOT APPLIED, NOT A MIGRATION, UNTESTED.
--
-- Store-scoped RLS for a possible future where the browser (or the server on
-- behalf of a user) queries Supabase with a per-user JWT instead of going
-- through Server Actions with the service role.
--
-- Today the app uses approach (a): anon / authenticated are fully denied
-- (migration B) and every query runs on the server, scoped by the verified
-- session. These policies only become meaningful if a JWT carrying the claims
-- below is issued and the matching GRANTs are given to `authenticated`.
-- Supabase currently signs with an ECC (P-256) key, so issuing such JWTs would
-- need Supabase Auth (custom access token hook) or a third-party auth setup.
--
-- Expected JWT claims:
--   role      = 'authenticated'
--   store_id  = stores.store_id of the session
--   staff_id  = staff.id of the session
--   app_role  = 'admin' | 'staff'
--
-- Limits of RLS to keep in mind (enforced in the server today):
--   * RLS cannot restrict which COLUMNS an UPDATE changes. Staff must not change
--     their own is_employee, pin_hash, session_version: use column GRANTs or a
--     trigger in addition to these policies.
--   * pin_hash / session_version must never be granted to authenticated.

create schema if not exists app;

create or replace function app.jwt_store_id() returns text
language sql stable as $$ select nullif(auth.jwt() ->> 'store_id', '') $$;

create or replace function app.jwt_staff_id() returns text
language sql stable as $$ select nullif(auth.jwt() ->> 'staff_id', '') $$;

create or replace function app.jwt_is_admin() returns boolean
language sql stable as $$ select coalesce(auth.jwt() ->> 'app_role', '') = 'admin' $$;

-- stores: read own store; admins update it.
create policy stores_select on public.stores for select to authenticated
  using (store_id = app.jwt_store_id());
create policy stores_update_admin on public.stores for update to authenticated
  using (store_id = app.jwt_store_id() and app.jwt_is_admin())
  with check (store_id = app.jwt_store_id());

-- staff: everyone in the store reads the roster; only admins write.
create policy staff_select on public.staff for select to authenticated
  using (store_id = app.jwt_store_id());
create policy staff_write_admin on public.staff for all to authenticated
  using (store_id = app.jwt_store_id() and app.jwt_is_admin())
  with check (store_id = app.jwt_store_id() and app.jwt_is_admin());

-- shift_requests: store-wide read; staff write their own rows, admins any row.
create policy shift_requests_select on public.shift_requests for select to authenticated
  using (store_id = app.jwt_store_id());
create policy shift_requests_write on public.shift_requests for all to authenticated
  using (store_id = app.jwt_store_id() and (staff_id::text = app.jwt_staff_id() or app.jwt_is_admin()))
  with check (store_id = app.jwt_store_id() and (staff_id::text = app.jwt_staff_id() or app.jwt_is_admin()));

-- staff_requests: own requests (or all for admins); staff insert their own; admins resolve.
create policy staff_requests_select on public.staff_requests for select to authenticated
  using (store_id = app.jwt_store_id() and (staff_id::text = app.jwt_staff_id() or app.jwt_is_admin()));
create policy staff_requests_insert_own on public.staff_requests for insert to authenticated
  with check (store_id = app.jwt_store_id() and staff_id::text = app.jwt_staff_id() and status = 'pending');
create policy staff_requests_update on public.staff_requests for update to authenticated
  using (store_id = app.jwt_store_id() and (staff_id::text = app.jwt_staff_id() or app.jwt_is_admin()))
  with check (store_id = app.jwt_store_id());

-- monthly_shifts: confirmed schedules for everyone in the store; drafts and writes for admins.
create policy monthly_shifts_select on public.monthly_shifts for select to authenticated
  using (store_id = app.jwt_store_id() and (status = 'confirmed' or app.jwt_is_admin()));
create policy monthly_shifts_write_admin on public.monthly_shifts for all to authenticated
  using (store_id = app.jwt_store_id() and app.jwt_is_admin())
  with check (store_id = app.jwt_store_id() and app.jwt_is_admin());

-- generation_settings, cleaning_logs: admin-only screens.
create policy generation_settings_admin on public.generation_settings for all to authenticated
  using (store_id = app.jwt_store_id() and app.jwt_is_admin())
  with check (store_id = app.jwt_store_id() and app.jwt_is_admin());
create policy cleaning_logs_admin on public.cleaning_logs for all to authenticated
  using (store_id = app.jwt_store_id() and app.jwt_is_admin())
  with check (store_id = app.jwt_store_id() and app.jwt_is_admin());

-- config_generation, staff_requirements: intentionally no policies (unused, fully denied).

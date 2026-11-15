-- Policies that existed in production right before migration B (captured 2026-11-15 13:15 JST
-- with section 5 of supabase/checks/privileges_and_dependencies.sql). 11 policies.
-- Only for rollback; all of them are fully open (using (true)).
create policy "Enable all access for cleaning_logs" on public.cleaning_logs as PERMISSIVE for ALL to public using (true) with check (true);
create policy "Enable all access for generation_settings" on public.generation_settings as PERMISSIVE for ALL to public using (true) with check (true);
create policy "Enable all for monthly_shifts" on public.monthly_shifts as PERMISSIVE for ALL to public using (true) with check (true);
create policy "Enable all access for now" on public.shift_requests as PERMISSIVE for ALL to public using (true) with check (true);
create policy "Allow all for development" on public.staff as PERMISSIVE for ALL to public using (true) with check (true);
create policy "Enable insert for all" on public.staff as PERMISSIVE for INSERT to public with check (true);
create policy "Enable read access for all users" on public.staff as PERMISSIVE for SELECT to public using (true);
create policy "Enable all access for staff_requests" on public.staff_requests as PERMISSIVE for ALL to public using (true) with check (true);
create policy "Allow all for requirements" on public.staff_requirements as PERMISSIVE for ALL to public using (true) with check (true);
create policy "Allow all for development" on public.stores as PERMISSIVE for ALL to public using (true) with check (true);
create policy allow_read_stores on public.stores as PERMISSIVE for SELECT to public using (true);

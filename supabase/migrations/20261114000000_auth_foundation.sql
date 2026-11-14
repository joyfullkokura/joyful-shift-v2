-- Migration A-pre: additive objects for server-side PIN authentication.
-- Safe to apply while the current client-side login is still in production:
-- nothing here removes or narrows existing access.

-- Incremented whenever existing sessions of a staff member must be invalidated
-- (PIN reset, PIN change). The signed session cookie carries the value it was
-- issued with, and the server rejects cookies whose value no longer matches.
alter table public.staff
  add column if not exists session_version integer not null default 0;

comment on column public.staff.session_version is 'Bumped to invalidate issued session cookies (PIN reset / change).';
comment on column public.staff.pin_hash is 'Server-side PIN hash. New format: scrypt$v1$N$r$p$salt$hash over HMAC(PIN_PEPPER, staff_id:pin). Legacy unsalted SHA-256 hex is migrated on the next successful login.';

-- Failure counters for PIN attempts and unauthenticated endpoints.
-- Keys look like "staff:<uuid>" or "ip:<hmac>" so no raw IP address is stored.
create table if not exists public.auth_throttle (
  key text primary key,
  failure_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  lock_level integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.auth_throttle is 'Server-only rate limit / lockout state. Accessed with the service role only.';

alter table public.auth_throttle enable row level security;
-- No policies on purpose: anon and authenticated must never read or write this table.
revoke all on table public.auth_throttle from anon, authenticated;
-- Newer Supabase projects no longer grant privileges on tables created via SQL
-- automatically, so the service role (used only on the server) needs an explicit
-- grant. auth_register_failure() runs with the caller's rights and relies on it too.
grant select, insert, update, delete on table public.auth_throttle to service_role;

-- Atomically records one failure for p_key and returns the lock expiry
-- (null when the key is not locked after this failure).
-- p_lock_steps_seconds escalates on repeated lockouts, e.g. {900, 3600, 86400}.
-- lock_level decays after 24 hours without failures.
create or replace function public.auth_register_failure(
  p_key text,
  p_max_failures integer,
  p_window_seconds integer,
  p_lock_steps_seconds integer[]
) returns timestamptz
language plpgsql
set search_path = public
as $$
declare
  v_row public.auth_throttle%rowtype;
  v_now timestamptz := now();
begin
  insert into public.auth_throttle (key) values (p_key) on conflict (key) do nothing;

  select * into v_row from public.auth_throttle where key = p_key for update;

  if v_row.updated_at < v_now - interval '24 hours' then
    v_row.lock_level := 0;
  end if;

  if v_row.window_started_at < v_now - make_interval(secs => p_window_seconds) then
    v_row.failure_count := 0;
    v_row.window_started_at := v_now;
  end if;

  v_row.failure_count := v_row.failure_count + 1;

  if v_row.failure_count >= p_max_failures then
    v_row.lock_level := v_row.lock_level + 1;
    v_row.locked_until := v_now + make_interval(secs => p_lock_steps_seconds[least(v_row.lock_level, array_length(p_lock_steps_seconds, 1))]);
    v_row.failure_count := 0;
    v_row.window_started_at := v_now;
  end if;

  update public.auth_throttle
     set failure_count = v_row.failure_count,
         window_started_at = v_row.window_started_at,
         locked_until = v_row.locked_until,
         lock_level = v_row.lock_level,
         updated_at = v_now
   where key = p_key;

  return case when v_row.locked_until > v_now then v_row.locked_until else null end;
end;
$$;

revoke all on function public.auth_register_failure(text, integer, integer, integer[]) from public, anon, authenticated;
grant execute on function public.auth_register_failure(text, integer, integer, integer[]) to service_role;

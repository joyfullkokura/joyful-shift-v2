-- Migration I: the 提出期限 of the 休み希望 gets a time, a "this month only"
-- override, and a record of who changed it. After the deadline, part-timers
-- can only view that month (checked by the Server Actions with the server clock).
--
--   stores.request_deadline_day        (existing) 前月〇日. Null = no deadline: nothing is locked.
--   stores.request_deadline_time       〇時〇分 of that day (Japan time). Default 23:59.
--   stores.request_deadline_updated_by / _updated_at
--                                      who last changed the monthly setting (staff id), and when.
--   store_request_deadline_overrides   one deadline for one store and target month
--                                      (target_month = first day of the month the requests are for).
--                                      Wins over the monthly setting for that month only.
--
-- Additive only. Apply BEFORE deploying the app version that reads these columns.

begin;

alter table public.stores
  add column if not exists request_deadline_time time not null default '23:59',
  add column if not exists request_deadline_updated_by text,
  add column if not exists request_deadline_updated_at timestamptz;

comment on column public.stores.request_deadline_day is '前月〇日: requests for a month are due on this day of the previous month (clamped to its last day). Null = no deadline.';
comment on column public.stores.request_deadline_time is 'Time (Asia/Tokyo) on request_deadline_day until which requests can be changed by part-timers.';
comment on column public.stores.request_deadline_updated_by is 'staff.id of who last changed the monthly deadline (kept as text after the staff member is deleted).';
comment on column public.stores.request_deadline_updated_at is 'When the monthly deadline was last changed.';

-- store_id gets exactly the type of stores.store_id; the foreign key is added
-- only when stores.store_id is unique (same as store_day_events in Migration G).
do $$
declare
  store_id_type text;
  store_id_is_unique boolean;
begin
  select format_type(a.atttypid, a.atttypmod) into store_id_type
    from pg_attribute a
   where a.attrelid = 'public.stores'::regclass and a.attname = 'store_id' and not a.attisdropped;
  if store_id_type is null then
    raise exception 'public.stores.store_id not found';
  end if;

  execute format($sql$
    create table if not exists public.store_request_deadline_overrides (
      store_id %s not null,
      target_month date not null check (extract(day from target_month) = 1),
      deadline_at timestamptz not null,
      updated_by text not null,
      updated_at timestamptz not null default now(),
      constraint store_request_deadline_overrides_store_month_key unique (store_id, target_month)
    )$sql$, store_id_type);

  select exists (
    select 1 from pg_index i
     where i.indrelid = 'public.stores'::regclass and i.indisunique and i.indnkeyatts = 1
       and i.indkey[0] = (select attnum from pg_attribute where attrelid = 'public.stores'::regclass and attname = 'store_id')
  ) into store_id_is_unique;

  if store_id_is_unique and not exists (
    select 1 from pg_constraint where conname = 'store_request_deadline_overrides_store_id_fkey'
  ) then
    alter table public.store_request_deadline_overrides
      add constraint store_request_deadline_overrides_store_id_fkey foreign key (store_id) references public.stores (store_id) on delete cascade;
  end if;
end
$$;

comment on table public.store_request_deadline_overrides is '提出期限 for one store and target month only (wins over stores.request_deadline_day / _time). Server (service role) only.';
comment on column public.store_request_deadline_overrides.updated_by is 'staff.id of who set it (text, kept after the staff member is deleted).';

-- RLS deny-all (no policies); only the server (service role) reads / writes.
alter table public.store_request_deadline_overrides enable row level security;
revoke all on table public.store_request_deadline_overrides from anon, authenticated;
grant select, insert, update, delete on table public.store_request_deadline_overrides to service_role;

alter table public.stores enable row level security;
revoke all on table public.stores from anon, authenticated;
grant select (request_deadline_time, request_deadline_updated_by, request_deadline_updated_at),
      insert (request_deadline_time, request_deadline_updated_by, request_deadline_updated_at),
      update (request_deadline_time, request_deadline_updated_by, request_deadline_updated_at)
   on table public.stores to service_role;

commit;

notify pgrst, 'reload schema';

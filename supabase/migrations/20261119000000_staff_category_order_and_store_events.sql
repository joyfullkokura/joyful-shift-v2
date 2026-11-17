-- Migration G: staff categories and display order (the order of the paper
-- 休日申込表), the request submission deadline, and per-day store events.
--
--   staff.category        社員 / DF / DK / LF / LK (D = ディナー, L = ランチ,
--                         F = フロア, K = キッチン). Null = not set yet.
--   staff.display_order   position inside the category (smaller first).
--                         Screens order by category, then display_order, then name.
--   stores.request_deadline_day
--                         "前月〇日": requests for a month are due on this day of
--                         the previous month (clamped to the month's last day).
--                         Display only; submitting stays possible afterwards.
--   store_day_events      one short note per store and date (shown in the
--                         イベント row of the 休み希望 table and the Excel sheet).
--
-- Additive only. Apply BEFORE deploying the app version that reads these columns.

begin;

alter table public.staff
  add column if not exists category text,
  add column if not exists display_order integer;

alter table public.staff drop constraint if exists staff_category_check;
alter table public.staff add constraint staff_category_check
  check (category is null or category in ('社員', 'DF', 'DK', 'LF', 'LK'));

comment on column public.staff.category is '社員 / DF / DK / LF / LK (paper form order). Null = not set. Independent of is_employee (admin rights).';
comment on column public.staff.display_order is 'Position inside the category; screens sort by category, display_order, name.';

alter table public.stores add column if not exists request_deadline_day smallint;
alter table public.stores drop constraint if exists stores_request_deadline_day_check;
alter table public.stores add constraint stores_request_deadline_day_check
  check (request_deadline_day is null or request_deadline_day between 1 and 31);
comment on column public.stores.request_deadline_day is '前月〇日: day of the previous month when requests are due (display only).';

-- store_id gets exactly the type of stores.store_id; the foreign key is added
-- only when stores.store_id is unique (it is the key the app uses everywhere).
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
    create table if not exists public.store_day_events (
      store_id %s not null,
      date date not null,
      note text not null check (char_length(note) between 1 and 100),
      updated_at timestamptz not null default now(),
      primary key (store_id, date)
    )$sql$, store_id_type);

  select exists (
    select 1 from pg_index i
     where i.indrelid = 'public.stores'::regclass and i.indisunique and i.indnkeyatts = 1
       and i.indkey[0] = (select attnum from pg_attribute where attrelid = 'public.stores'::regclass and attname = 'store_id')
  ) into store_id_is_unique;

  if store_id_is_unique and not exists (
    select 1 from pg_constraint where conname = 'store_day_events_store_id_fkey'
  ) then
    alter table public.store_day_events
      add constraint store_day_events_store_id_fkey foreign key (store_id) references public.stores (store_id) on delete cascade;
  end if;
end
$$;

comment on table public.store_day_events is 'イベント row of the 休み希望 table: one note per store and date. Server (service role) only.';

-- RLS deny-all (no policies); only the server (service role) reads / writes.
alter table public.store_day_events enable row level security;
revoke all on table public.store_day_events from anon, authenticated;
grant select, insert, update, delete on table public.store_day_events to service_role;

alter table public.staff enable row level security;
revoke all on table public.staff from anon, authenticated;
grant select, insert, update, delete on table public.staff to service_role;
grant select (category, display_order), insert (category, display_order), update (category, display_order) on table public.staff to service_role;

alter table public.stores enable row level security;
revoke all on table public.stores from anon, authenticated;
grant select, insert, update, delete on table public.stores to service_role;
grant select (request_deadline_day), insert (request_deadline_day), update (request_deadline_day) on table public.stores to service_role;

commit;

notify pgrst, 'reload schema';

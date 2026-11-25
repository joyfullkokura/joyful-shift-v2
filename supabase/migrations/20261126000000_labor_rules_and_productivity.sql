-- Migration H: labor rules, on-site rules and labor productivity (人時売上).
-- Additive only; every default keeps today's behaviour until the generator
-- starts using the columns (later commits). Apply BEFORE deploying the app
-- version that reads them.
--
-- staff
--   is_minor              under 18 (no late-night work). Not derivable: the manager confirms it.
--   flags_confirmed_at    when the manager last confirmed is_minor and the flags below
--                         (null = 「未確認」 on the roster).
--   can_lead / can_open / can_close
--                         may be the shift lead / open / close the store.
--   weekly_hour_cap / monthly_hour_cap
--                         personal caps (e.g. the annual income threshold). Null = none.
-- stores
--   labor_time_mode       'weekly_40'        8h per day and 40h per week (legal default)
--                         'monthly_variable' 1-month variable working hours system:
--                                            8h per day and the monthly legal total
--                                            (40h x days / 7: 160.0 / 171.4 / 177.1 h)
--   daily_max_hours / weekly_max_hours, min_shift_hours, rest_interval_hours,
--   late_night_start / late_night_end, week_start_day (0 = Sunday)
--   check_lead / check_open_close
--                         require a lead / opener / closer (off by default)
--   novice_rank_floor / novice_rule
--                         hours staffed only below this rank: soft penalty or not allowed
--   apply_weekly_20h_line part-timers above 20h per week (social insurance) are penalised
--   target_sales_per_labor_hour   company target (人時売上), 4,200 yen
--   sales_offset_hours    sales are recorded at payment; visits are about this much earlier
-- generation_settings (per month and day type: wd / we / special day)
--   expected_sales        expected sales of one such day (yen)
--   required_curve        required staff per job and hour:
--                         {"ホール": {"10": 2, ...}, "キッチン": {...}, "closing_prep": ["21"]}
-- store_hourly_sales      average sales per hour for 平日 (wd) / 土日祝 (we), entered by
--                         hand or computed from the POS 「時間別売上実績表」.

begin;

alter table public.staff
  add column if not exists is_minor boolean not null default false,
  add column if not exists flags_confirmed_at timestamptz,
  add column if not exists can_lead boolean not null default false,
  add column if not exists can_open boolean not null default false,
  add column if not exists can_close boolean not null default false,
  add column if not exists weekly_hour_cap numeric(5, 2),
  add column if not exists monthly_hour_cap numeric(6, 2);

alter table public.staff drop constraint if exists staff_hour_caps_check;
alter table public.staff add constraint staff_hour_caps_check check (
  (weekly_hour_cap is null or weekly_hour_cap between 0 and 168)
  and (monthly_hour_cap is null or monthly_hour_cap between 0 and 744)
);

-- Starting values estimated from existing data (the manager confirms them on the roster;
-- flags_confirmed_at stays null, so every row shows 「未確認」 until then).
update public.staff
   set can_lead = is_employee or rank = 'A',
       can_open = is_employee,
       can_close = is_employee or coalesce(skills::text, '') like '%レジ締め%'
 where flags_confirmed_at is null;

alter table public.stores
  add column if not exists labor_time_mode text not null default 'weekly_40',
  add column if not exists daily_max_hours numeric(4, 2) not null default 8,
  add column if not exists weekly_max_hours numeric(5, 2) not null default 40,
  add column if not exists min_shift_hours numeric(4, 2) not null default 3,
  add column if not exists rest_interval_hours numeric(4, 2) not null default 11,
  add column if not exists late_night_start time not null default '22:00',
  add column if not exists late_night_end time not null default '05:00',
  add column if not exists week_start_day smallint not null default 0,
  add column if not exists check_lead boolean not null default false,
  add column if not exists check_open_close boolean not null default false,
  add column if not exists novice_rank_floor text not null default 'B',
  add column if not exists novice_rule text not null default 'soft',
  add column if not exists apply_weekly_20h_line boolean not null default true,
  add column if not exists target_sales_per_labor_hour integer not null default 4200,
  add column if not exists sales_offset_hours numeric(3, 1) not null default 1;

alter table public.stores drop constraint if exists stores_labor_rules_check;
alter table public.stores add constraint stores_labor_rules_check check (
  labor_time_mode in ('weekly_40', 'monthly_variable')
  and daily_max_hours between 1 and 24
  and weekly_max_hours between 1 and 168
  and min_shift_hours between 0 and 24
  and rest_interval_hours between 0 and 24
  and week_start_day between 0 and 6
  and novice_rank_floor in ('A', 'B', 'C')
  and novice_rule in ('soft', 'hard')
  and target_sales_per_labor_hour between 1 and 1000000
  and sales_offset_hours between 0 and 6
);

alter table public.generation_settings
  add column if not exists expected_sales integer,
  add column if not exists required_curve jsonb;

alter table public.generation_settings drop constraint if exists generation_settings_expected_sales_check;
alter table public.generation_settings add constraint generation_settings_expected_sales_check
  check (expected_sales is null or expected_sales between 0 and 100000000);

-- store_id gets exactly the type of stores.store_id (text), with the same foreign key as store_day_events.
do $$
declare
  store_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into store_id_type
    from pg_attribute a
   where a.attrelid = 'public.stores'::regclass and a.attname = 'store_id' and not a.attisdropped;
  execute format($sql$
    create table if not exists public.store_hourly_sales (
      store_id %s not null references public.stores (store_id) on delete cascade,
      day_type text not null check (day_type in ('wd', 'we')),
      hour smallint not null check (hour between 0 and 23),
      sales integer not null check (sales between 0 and 100000000),
      customers numeric(8, 1) check (customers is null or customers between 0 and 100000),
      source text not null default 'manual' check (source in ('manual', 'pos')),
      period_label text check (period_label is null or char_length(period_label) <= 100),
      updated_at timestamptz not null default now(),
      primary key (store_id, day_type, hour)
    )$sql$, store_id_type);
end
$$;

comment on table public.store_hourly_sales is 'Average sales per hour for 平日 / 土日祝 (manual or from the POS report). Server (service role) only.';

-- RLS deny-all (no policies); only the server (service role) reads / writes.
alter table public.store_hourly_sales enable row level security;
revoke all on table public.store_hourly_sales from anon, authenticated;
grant select, insert, update, delete on table public.store_hourly_sales to service_role;

do $$
declare
  target record;
begin
  for target in select * from (values ('staff'), ('stores'), ('generation_settings')) as t(table_name) loop
    execute format('alter table public.%I enable row level security', target.table_name);
    execute format('revoke all on table public.%I from anon, authenticated', target.table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', target.table_name);
  end loop;
end
$$;

grant select (is_minor, flags_confirmed_at, can_lead, can_open, can_close, weekly_hour_cap, monthly_hour_cap),
      insert (is_minor, flags_confirmed_at, can_lead, can_open, can_close, weekly_hour_cap, monthly_hour_cap),
      update (is_minor, flags_confirmed_at, can_lead, can_open, can_close, weekly_hour_cap, monthly_hour_cap)
   on table public.staff to service_role;
grant select (labor_time_mode, daily_max_hours, weekly_max_hours, min_shift_hours, rest_interval_hours, late_night_start,
              late_night_end, week_start_day, check_lead, check_open_close, novice_rank_floor, novice_rule,
              apply_weekly_20h_line, target_sales_per_labor_hour, sales_offset_hours),
      update (labor_time_mode, daily_max_hours, weekly_max_hours, min_shift_hours, rest_interval_hours, late_night_start,
              late_night_end, week_start_day, check_lead, check_open_close, novice_rank_floor, novice_rule,
              apply_weekly_20h_line, target_sales_per_labor_hour, sales_offset_hours)
   on table public.stores to service_role;
grant select (expected_sales, required_curve), insert (expected_sales, required_curve), update (expected_sales, required_curve)
   on table public.generation_settings to service_role;

commit;

notify pgrst, 'reload schema';

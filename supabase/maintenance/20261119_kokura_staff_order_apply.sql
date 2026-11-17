-- 小倉店 (KOKURA): set the initial categories / display order. Run the preview
-- file first. Keep the list identical to the preview's.
--
-- * List entries: the list's category, display_order = position.
-- * Everyone else on the roster: the end of the suggested category (or of the
--   category given in kokura_overrides), display_order 1000+ in name order.
-- * Stops and changes nothing if a list entry does not match exactly one
--   person, if one person matches two entries, or if an override is invalid.
-- Admin rights (is_employee) and the roster itself are not changed.

begin;

create temporary table kokura_list (category text, position integer, name text) on commit drop;
insert into kokura_list (category, position, name) values
  ('社員', 1, '多田'),
  ('DF', 1, '宝村文子'), ('DF', 2, '高木'), ('DF', 3, '武久'), ('DF', 4, '西村'), ('DF', 5, '扇'),
  ('DF', 6, '笹谷'), ('DF', 7, '宮川'), ('DF', 8, '梅津'), ('DF', 9, '早田'), ('DF', 10, '志波'),
  ('DK', 1, '小田川'), ('DK', 2, '内田'), ('DK', 3, '十河'), ('DK', 4, '井上'), ('DK', 5, '妹背'),
  ('DK', 6, '八田'), ('DK', 7, 'キサン'), ('DK', 8, '太田'), ('DK', 9, '野宮'),
  ('LF', 1, '西田'), ('LF', 2, '末益'), ('LF', 3, '河野'), ('LF', 4, '西村（華）'),
  ('LK', 1, '渡部'), ('LK', 2, '清水'), ('LK', 3, '松村'), ('LK', 4, '山形');

-- Optional: categories for people NOT on the list, replacing the suggestion.
-- Example: insert into kokura_overrides (name, category) values ('〇〇', 'LK');
create temporary table kokura_overrides (name text, category text) on commit drop;

do $$
declare
  problems text;
begin
  create temporary table kokura_staff on commit drop as
    select s.id, s.name, s.is_employee, s.main_job, s.weekly_availability, s.work_start_1
      from public.staff s
     where s.store_id = 'KOKURA';

  create temporary table kokura_matches on commit drop as
    select l.category, l.position, l.name as list_name, s.id as staff_id
      from kokura_list l
      join kokura_staff s
        on s.name = l.name
        or (not exists (select 1 from kokura_staff e where e.name = l.name) and s.name like l.name || '%');

  select string_agg(c.name || ' (' || c.match_count || ')', ', ') into problems
    from (
      select l.name, (select count(*) from kokura_matches m where m.category = l.category and m.position = l.position) as match_count
        from kokura_list l
    ) c
   where c.match_count <> 1;
  if problems is not null then
    raise exception 'List entries not matching exactly one person: %', problems;
  end if;

  select string_agg(d.name, ', ') into problems
    from (
      select s.name
        from kokura_matches m join kokura_staff s on s.id = m.staff_id
       group by m.staff_id, s.name having count(*) > 1
    ) d;
  if problems is not null then
    raise exception 'People matched by two list entries: %', problems;
  end if;

  select string_agg(o.name || ' -> ' || coalesce(o.category, 'null'), ', ') into problems
    from kokura_overrides o
   where o.category is null or o.category not in ('社員', 'DF', 'DK', 'LF', 'LK')
      or (select count(*) from kokura_staff s where s.name = o.name) <> 1
      or exists (select 1 from kokura_matches m join kokura_staff s on s.id = m.staff_id where s.name = o.name);
  if problems is not null then
    raise exception 'Invalid overrides (unknown category, no single exact name, or a list member): %', problems;
  end if;

  -- People on the list.
  update public.staff s
     set category = m.category, display_order = m.position
    from kokura_matches m
   where s.id = m.staff_id and s.store_id = 'KOKURA';

  -- Everyone else: the end of the suggested (or overridden) category.
  with suggested as (
    select s.id, s.name,
           coalesce(o.category,
             case
               when s.is_employee then '社員'
               else (case
                       when coalesce(w.available, 0) > 0 then (case when w.evening * 2 > w.available then 'D' else 'L' end)
                       when s.work_start_1 is not null and s.work_start_1::text >= '16:00' then 'D'
                       else 'L'
                     end)
                    || (case when s.main_job = 'キッチン' then 'K' else 'F' end)
             end) as category
      from kokura_staff s
      left join kokura_overrides o on o.name = s.name
      left join lateral (
        select count(*) filter (where d.value->>'kind' <> 'off') as available,
               count(*) filter (where d.value->>'kind' in ('from', 'range') and d.value->>'start' >= '16:00') as evening
          from jsonb_each(case when jsonb_typeof(s.weekly_availability) = 'object' then s.weekly_availability else '{}'::jsonb end) d
      ) w on true
     where not exists (select 1 from kokura_matches m where m.staff_id = s.id)
  ), ordered as (
    select id, category, 1000 + row_number() over (partition by category order by name) as display_order
      from suggested
  )
  update public.staff s
     set category = o.category, display_order = o.display_order
    from ordered o
   where s.id = o.id and s.store_id = 'KOKURA';
end
$$;

-- Result (the order every screen will use).
select s.category, s.display_order, s.name, s.is_employee
  from public.staff s
 where s.store_id = 'KOKURA'
 order by array_position(array['社員', 'DF', 'DK', 'LF', 'LK'], s.category) nulls last, s.display_order nulls last, s.name;

commit;

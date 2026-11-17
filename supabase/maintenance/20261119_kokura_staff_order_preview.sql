-- 小倉店 (KOKURA): preview of the initial categories / display order (read-only).
-- Run after migration G. Nothing is changed. Review, adjust the list in both
-- this file and ..._apply.sql if needed, then run the apply file.
--
-- Matching: exact name first; if no staff member has exactly that name, a
-- name that starts with it (e.g. 「多田」 -> 「多田 太郎」). Every list entry must
-- match exactly one person (match_count = 1) before applying.
--
-- section
--   1 list      the paper form order (category / position from the list)
--   2 unlisted  roster people not on the list: placed at the end of the
--               suggested category (same rule as approving a new registration:
--               社員 if they have admin rights, else F/K from the main job and
--               D/L from the weekday times: D when most available days start
--               at 16:00 or later). is_employee shows the admin rights.

with list(category, position, name) as (values
  ('社員', 1, '多田'),
  ('DF', 1, '宝村文子'), ('DF', 2, '高木'), ('DF', 3, '武久'), ('DF', 4, '西村'), ('DF', 5, '扇'),
  ('DF', 6, '笹谷'), ('DF', 7, '宮川'), ('DF', 8, '梅津'), ('DF', 9, '早田'), ('DF', 10, '志波'),
  ('DK', 1, '小田川'), ('DK', 2, '内田'), ('DK', 3, '十河'), ('DK', 4, '井上'), ('DK', 5, '妹背'),
  ('DK', 6, '八田'), ('DK', 7, 'キサン'), ('DK', 8, '太田'), ('DK', 9, '野宮'),
  ('LF', 1, '西田'), ('LF', 2, '末益'), ('LF', 3, '河野'), ('LF', 4, '西村（華）'),
  ('LK', 1, '渡部'), ('LK', 2, '清水'), ('LK', 3, '松村'), ('LK', 4, '山形')
),
staff_k as (
  select s.id, s.name, s.is_employee, s.main_job, s.weekly_availability, s.work_start_1,
         exists (
           select 1 from public.staff_requests r
            where r.store_id = s.store_id and r.staff_id::text = s.id::text
              and r.type = 'new_staff' and r.status = 'pending'
         ) as pending_registration
    from public.staff s
   where s.store_id = 'KOKURA'
),
candidates as (
  select l.category, l.position, l.name as list_name, s.id as staff_id
    from list l
    join staff_k s
      on s.name = l.name
      or (not exists (select 1 from staff_k e where e.name = l.name) and s.name like l.name || '%')
),
suggested as (
  select s.id,
         case
           when s.is_employee then '社員'
           else (case
                   when coalesce(w.available, 0) > 0 then (case when w.evening * 2 > w.available then 'D' else 'L' end)
                   when s.work_start_1 is not null and s.work_start_1::text >= '16:00' then 'D'
                   else 'L'
                 end)
                || (case when s.main_job = 'キッチン' then 'K' else 'F' end)
         end as suggested_category
    from staff_k s
    left join lateral (
      select count(*) filter (where d.value->>'kind' <> 'off') as available,
             count(*) filter (where d.value->>'kind' in ('from', 'range') and d.value->>'start' >= '16:00') as evening
        from jsonb_each(case when jsonb_typeof(s.weekly_availability) = 'object' then s.weekly_availability else '{}'::jsonb end) d
    ) w on true
)
select * from (
select 1 as section, l.category, l.position, l.name as list_name,
       count(c.staff_id) as match_count,
       string_agg(s.name || ' (' || left(s.id::text, 8) || ')', ' / ' order by s.name) as staff,
       string_agg(case when s.is_employee then 'true' else 'false' end, ' / ' order by s.name) as is_employee,
       string_agg(coalesce(s.main_job, '-'), ' / ' order by s.name) as main_job,
       bool_or(s.pending_registration) as pending_registration,
       null::text as suggested_category
  from list l
  left join candidates c on c.category = l.category and c.position = l.position
  left join staff_k s on s.id = c.staff_id
 group by l.category, l.position, l.name
union all
select 2 as section, g.suggested_category, null, null, null,
       s.name || ' (' || left(s.id::text, 8) || ')', case when s.is_employee then 'true' else 'false' end,
       coalesce(s.main_job, '-'), s.pending_registration, g.suggested_category
  from staff_k s
  join suggested g on g.id = s.id
 where not exists (select 1 from candidates c where c.staff_id = s.id)
) preview
order by section,
         array_position(array['社員', 'DF', 'DK', 'LF', 'LK'], category),
         position nulls last, staff;

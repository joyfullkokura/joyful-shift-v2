-- Migration F: at most one pending condition change per staff member.
-- The server already refuses a second request while one is pending; this index
-- also stops two requests sent at the same moment. Index only, no new table.
--
-- Prerequisite: no staff member has two pending condition_change rows
-- (section 11 of supabase/checks/privileges_and_dependencies.sql, BEFORE query).
-- Creating the index fails, and changes nothing, if any exist.

create unique index if not exists staff_requests_one_pending_condition_change
  on public.staff_requests (store_id, staff_id)
  where type = 'condition_change' and status = 'pending';

comment on index public.staff_requests_one_pending_condition_change is
  'One pending condition change per staff member (approval / rejection frees the slot).';

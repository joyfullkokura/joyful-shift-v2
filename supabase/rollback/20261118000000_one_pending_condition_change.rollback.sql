-- Rollback for migration F (20261118000000_one_pending_condition_change.sql).
-- NOT a migration: run manually only if the index has to be removed. The server
-- keeps refusing a second pending request on its own.

drop index if exists public.staff_requests_one_pending_condition_change;

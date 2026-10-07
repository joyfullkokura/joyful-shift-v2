alter table public.staff
  add column if not exists pin_hash text;

comment on column public.staff.pin_hash is 'SHA-256 hash of the staff four-digit PIN. The PIN itself is never stored in Supabase.';

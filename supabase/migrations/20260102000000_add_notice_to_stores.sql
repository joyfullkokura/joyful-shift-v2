alter table public.stores
  add column if not exists notice text;

comment on column public.stores.notice is 'Store dashboard notice displayed to authenticated staff.';

alter table public.entries add column if not exists region text not null default '';
alter table public.entries add column if not exists remote_connections jsonb not null default '[]'::jsonb;
-- Existing tool/remote_id remain the primary connection for compatibility.

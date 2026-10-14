-- Выполните в SQL Editor нового проекта Supabase. Включите приглашения только администратором.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  role text not null default 'reader' check (role in ('admin', 'reader')),
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists email text not null default '';

create or replace function public.create_wiki_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, role) values (new.id, coalesce(new.email, ''), 'reader')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
drop trigger if exists wiki_user_created on auth.users;
create trigger wiki_user_created after insert on auth.users
for each row execute function public.create_wiki_profile();
insert into public.profiles(id, email, role)
select id, coalesce(email, ''), 'reader' from auth.users
on conflict (id) do update set email = excluded.email;

create or replace function public.prevent_last_wiki_admin_removal()
returns trigger language plpgsql as $$
begin
  if old.role = 'admin' and new.role <> 'admin' and
     (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'The last wiki admin cannot be removed';
  end if;
  return new;
end;
$$;
drop trigger if exists last_wiki_admin_guard on public.profiles;
create trigger last_wiki_admin_guard before update of role on public.profiles
for each row execute function public.prevent_last_wiki_admin_removal();

create or replace function public.is_wiki_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create table if not exists public.sections (
  id uuid primary key,
  kind text not null check (kind in ('knowledge', 'cases', 'access')),
  parent_id uuid references public.sections(id) on delete restrict,
  title text not null check (length(trim(title)) > 0),
  visibility text not null default 'all' check (visibility in ('all', 'admins')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.check_wiki_section()
returns trigger language plpgsql as $$
declare parent_kind text;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'A section cannot contain itself'; end if;
    select kind into parent_kind from public.sections where id = new.parent_id;
    if parent_kind is distinct from new.kind then raise exception 'Parent section must have the same kind'; end if;
    if exists (
      with recursive descendants as (
        select id from public.sections where parent_id = new.id
        union all
        select s.id from public.sections s join descendants d on s.parent_id = d.id
      ) select 1 from descendants where id = new.parent_id
    ) then raise exception 'Section hierarchy cannot contain a cycle'; end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists sections_checked on public.sections;
create trigger sections_checked before insert or update on public.sections
for each row execute function public.check_wiki_section();

create or replace function public.can_read_wiki_section(target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with recursive ancestors as (
    select id, parent_id, visibility from public.sections where id = target_id
    union all
    select s.id, s.parent_id, s.visibility from public.sections s join ancestors a on s.id = a.parent_id
  )
  select public.is_wiki_admin() or
    (exists(select 1 from ancestors) and not exists(select 1 from ancestors where visibility = 'admins'));
$$;

create table if not exists public.entries (
  id uuid primary key,
  type text not null check (type in ('knowledge', 'cases', 'access')),
  section_id uuid references public.sections(id) on delete restrict,
  title text not null check (length(trim(title)) > 0),
  summary text not null default '',
  visibility text not null default 'all' check (visibility in ('all', 'admins')),
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  device text not null default '',
  tool text not null default '',
  remote_id text not null default '',
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.entries add column if not exists section_id uuid references public.sections(id) on delete restrict;
alter table public.entries add column if not exists visibility text not null default 'all';
alter table public.entries add column if not exists blocks jsonb not null default '[]'::jsonb;
alter table public.entries add column if not exists author_id uuid references auth.users(id) on delete set null;
alter table public.entries add column if not exists device text not null default '';
alter table public.entries add column if not exists tool text not null default '';
alter table public.entries add column if not exists remote_id text not null default '';

create table if not exists public.entry_versions (
  id bigint generated always as identity primary key,
  entry_id uuid not null,
  snapshot jsonb not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  action text not null check (action in ('UPDATE', 'DELETE'))
);
create index if not exists entry_versions_entry_id_idx
  on public.entry_versions(entry_id, changed_at desc);
create or replace function public.record_wiki_entry_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.entry_versions(entry_id, snapshot, changed_by, action)
  values (old.id, to_jsonb(old), auth.uid(), TG_OP);
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists entry_version_recorded on public.entries;
create trigger entry_version_recorded before update or delete on public.entries
for each row execute function public.record_wiki_entry_version();

create or replace function public.check_wiki_entry()
returns trigger language plpgsql as $$
declare section_kind text;
begin
  if new.section_id is not null then
    select kind into section_kind from public.sections where id = new.section_id;
    if section_kind is distinct from new.type then raise exception 'Entry and section kinds must match'; end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists entries_checked on public.entries;
create trigger entries_checked before insert or update on public.entries
for each row execute function public.check_wiki_entry();

create or replace function public.can_read_wiki_entry(target_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.entries e where e.id = target_id and
      (public.is_wiki_admin() or
       (e.visibility = 'all' and (e.section_id is null or public.can_read_wiki_section(e.section_id))))
  );
$$;

alter table public.profiles enable row level security;
alter table public.sections enable row level security;
alter table public.entries enable row level security;
alter table public.entry_versions enable row level security;
revoke all on public.profiles, public.sections, public.entries, public.entry_versions from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.sections, public.entries to authenticated;
grant update(role) on public.profiles to authenticated;
grant select on public.entry_versions to authenticated;

-- Старые политики удаляются, чтобы скрипт можно было выполнить повторно.
drop policy if exists "profiles: read self or admin" on public.profiles;
drop policy if exists "profiles: admin updates" on public.profiles;
create policy "profiles: read self or admin" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_wiki_admin());
create policy "profiles: admin updates" on public.profiles for update to authenticated
  using (public.is_wiki_admin()) with check (public.is_wiki_admin());

drop policy if exists "entry versions: admin read" on public.entry_versions;
create policy "entry versions: admin read" on public.entry_versions for select to authenticated
  using (public.is_wiki_admin());

drop policy if exists "sections: permitted read" on public.sections;
drop policy if exists "sections: admin insert" on public.sections;
drop policy if exists "sections: admin update" on public.sections;
drop policy if exists "sections: admin delete" on public.sections;
create policy "sections: permitted read" on public.sections for select to authenticated
  using (public.can_read_wiki_section(id));
create policy "sections: admin insert" on public.sections for insert to authenticated
  with check (public.is_wiki_admin());
create policy "sections: admin update" on public.sections for update to authenticated
  using (public.is_wiki_admin()) with check (public.is_wiki_admin());
create policy "sections: admin delete" on public.sections for delete to authenticated
  using (public.is_wiki_admin());

drop policy if exists "entries: permitted read" on public.entries;
drop policy if exists "team can read entries" on public.entries;
drop policy if exists "team can add entries" on public.entries;
drop policy if exists "team can edit entries" on public.entries;
drop policy if exists "team can delete entries" on public.entries;
drop policy if exists "entries: admin insert" on public.entries;
drop policy if exists "entries: admin update" on public.entries;
drop policy if exists "entries: admin delete" on public.entries;
create policy "entries: permitted read" on public.entries for select to authenticated
  using (public.can_read_wiki_entry(id));
create policy "entries: admin insert" on public.entries for insert to authenticated
  with check (public.is_wiki_admin());
create policy "entries: admin update" on public.entries for update to authenticated
  using (public.is_wiki_admin()) with check (public.is_wiki_admin());
create policy "entries: admin delete" on public.entries for delete to authenticated
  using (public.is_wiki_admin());

-- Приватный бакет. Путь объекта: <entry_uuid>/<image_uuid>.<extension>.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('wiki-images', 'wiki-images', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.wiki_image_entry_id(object_name text)
returns uuid language sql immutable as $$
  select case
    when split_part(object_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(object_name, '/', 1)::uuid
    else null::uuid
  end;
$$;
alter table storage.objects enable row level security;
drop policy if exists "wiki images: permitted read" on storage.objects;
drop policy if exists "wiki images: admin insert" on storage.objects;
drop policy if exists "wiki images: admin update" on storage.objects;
drop policy if exists "wiki images: admin delete" on storage.objects;
create policy "wiki images: permitted read" on storage.objects for select to authenticated
  using (bucket_id = 'wiki-images' and public.can_read_wiki_entry(public.wiki_image_entry_id(name)));
create policy "wiki images: admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'wiki-images' and public.is_wiki_admin() and
    exists(select 1 from public.entries where id = public.wiki_image_entry_id(name)));
create policy "wiki images: admin update" on storage.objects for update to authenticated
  using (bucket_id = 'wiki-images' and public.is_wiki_admin())
  with check (bucket_id = 'wiki-images' and public.is_wiki_admin());
create policy "wiki images: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'wiki-images' and public.is_wiki_admin());

-- Начальные разделы. Их можно переименовать или удалить в админке.
insert into public.sections(id, kind, title, sort_order)
select md5(kind || ':' || title)::uuid, kind, title, ord
from (values
  ('knowledge','Телефония',1),('knowledge','Интернет',2),('knowledge','МФУ и принтеры',3),('knowledge','Битрикс',4),('knowledge','1С',5),('knowledge','Прочее',6),
  ('cases','Телефония',1),('cases','Интернет',2),('cases','МФУ и принтеры',3),('cases','Битрикс',4),('cases','1С',5),('cases','Прочее',6),
  ('access','Рабочие станции',1),('access','Серверы',2),('access','Прочее',3)
) as seed(kind,title,ord)
on conflict (id) do nothing;

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
returns trigger language plpgsql set search_path = '' as $$
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
returns trigger language plpgsql set search_path = '' as $$
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
returns trigger language plpgsql set search_path = '' as $$
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
returns uuid language sql immutable set search_path = '' as $$
  select case
    when split_part(object_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(object_name, '/', 1)::uuid
    else null::uuid
  end;
$$;
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

-- Политикам нужны функции проверки прав, но анонимный RPC-вызов им не нужен.
revoke execute on function public.create_wiki_profile(), public.record_wiki_entry_version()
  from public, anon, authenticated;
revoke execute on function public.is_wiki_admin(), public.can_read_wiki_section(uuid),
  public.can_read_wiki_entry(uuid), public.wiki_image_entry_id(text)
  from public, anon;
grant execute on function public.is_wiki_admin(), public.can_read_wiki_section(uuid),
  public.can_read_wiki_entry(uuid), public.wiki_image_entry_id(text)
  to authenticated;

-- Начальные разделы. Их можно переименовать или удалить в админке.
insert into public.sections(id, kind, title, sort_order)
select md5(kind || ':' || title)::uuid, kind, title, ord
from (values
  ('knowledge','Телефония',1),('knowledge','Интернет',2),('knowledge','МФУ и принтеры',3),('knowledge','Битрикс',4),('knowledge','1С',5),('knowledge','Прочее',6),
  ('cases','Телефония',1),('cases','Интернет',2),('cases','МФУ и принтеры',3),('cases','Битрикс',4),('cases','1С',5),('cases','Прочее',6),
  ('access','Рабочие станции',1),('access','Серверы',2),('access','Прочее',3)
) as seed(kind,title,ord)
on conflict (id) do nothing;


-- Дополнение WikiHMRU: каталог, публикация, корзина, комментарии и GLPI.
alter table public.entries add column if not exists pinned boolean not null default false;
alter table public.entries add column if not exists tags text[] not null default '{}' check (cardinality(tags) <= 20);
alter table public.entries add column if not exists publication_state text not null default 'published' check (publication_state in ('draft', 'published'));
alter table public.entries add column if not exists relevance text not null default 'verified' check (relevance in ('verified', 'review', 'outdated'));
alter table public.entries add column if not exists related_ids uuid[] not null default '{}' check (cardinality(related_ids) <= 30 and not (id = any(related_ids)));
alter table public.entries add column if not exists glpi_ticket_ids bigint[] not null default '{}' check (cardinality(glpi_ticket_ids) <= 20);
alter table public.entries add column if not exists deleted_at timestamptz;
create index if not exists entries_catalog_idx on public.entries(publication_state, pinned desc, updated_at desc) where deleted_at is null;

create or replace function public.check_wiki_entry_metadata()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from unnest(new.tags) t where t is null or length(trim(t)) = 0 or length(t) > 50) then
    raise exception 'Invalid tag';
  end if;
  if exists(select 1 from unnest(new.glpi_ticket_ids) n where n is null or n < 1 or n > 9007199254740991) then
    raise exception 'Invalid GLPI ticket number';
  end if;
  return new;
end;
$$;
drop trigger if exists entries_metadata_checked on public.entries;
create trigger entries_metadata_checked before insert or update on public.entries
for each row execute function public.check_wiki_entry_metadata();
revoke execute on function public.check_wiki_entry_metadata() from public, anon, authenticated;

-- This function is also used by the existing photo policy.
create or replace function public.can_read_wiki_entry(target_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.entries e where e.id = target_id and
      (public.is_wiki_admin() or
       (e.deleted_at is null and e.publication_state = 'published' and e.visibility = 'all' and
        (e.section_id is null or public.can_read_wiki_section(e.section_id))))
  );
$$;
revoke execute on function public.can_read_wiki_entry(uuid) from public, anon;
grant execute on function public.can_read_wiki_entry(uuid) to authenticated;
-- Browser deletion becomes a reversible UPDATE; prevent permanent DELETE via REST.
revoke delete on public.entries from authenticated;

create table if not exists public.wiki_settings (
  id integer primary key check (id = 1),
  glpi_ticket_url_template text not null default '' check (length(glpi_ticket_url_template) <= 2048)
);
insert into public.wiki_settings(id,glpi_ticket_url_template) values(1,'https://helpdesk.hmru.ru:8080/front/ticket.form.php?id={id}') on conflict(id) do nothing;
alter table public.wiki_settings enable row level security;
revoke all on public.wiki_settings from public, anon, authenticated;
grant select on public.wiki_settings to authenticated;
grant update(glpi_ticket_url_template) on public.wiki_settings to authenticated;
drop policy if exists "settings: authenticated read" on public.wiki_settings;
drop policy if exists "settings: admin update" on public.wiki_settings;
create policy "settings: authenticated read" on public.wiki_settings for select to authenticated using (true);
create policy "settings: admin update" on public.wiki_settings for update to authenticated
using ((select public.is_wiki_admin())) with check ((select public.is_wiki_admin()));

create table if not exists public.entry_comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  author_name text not null default '',
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists entry_comments_entry_idx on public.entry_comments(entry_id, created_at desc, id);
create index if not exists entry_comments_author_idx on public.entry_comments(author_id);
create schema if not exists wiki_private;
revoke all on schema wiki_private from public, anon, authenticated;
create or replace function wiki_private.check_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to comment'; end if;
  if TG_OP = 'INSERT' then
    if new.author_id <> auth.uid() then raise exception 'Invalid comment author'; end if;
    select coalesce(nullif(split_part(p.email, '@', 1), ''), 'Участник') into new.author_name
    from public.profiles p where p.id = auth.uid();
    new.author_name = coalesce(new.author_name, 'Участник');
    new.created_at = now();
  else
    if new.author_id <> old.author_id or new.entry_id <> old.entry_id or new.created_at <> old.created_at then
      raise exception 'Comment identity cannot be changed';
    end if;
    new.author_name = old.author_name;
  end if;
  new.body = trim(new.body);
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists comment_checked on public.entry_comments;
create trigger comment_checked before insert or update on public.entry_comments
for each row execute function wiki_private.check_comment();
revoke execute on function wiki_private.check_comment() from public, anon, authenticated;
alter table public.entry_comments enable row level security;
revoke all on public.entry_comments from public, anon, authenticated;
grant select, insert, delete on public.entry_comments to authenticated;
grant update(body) on public.entry_comments to authenticated;
drop policy if exists "comments: permitted read" on public.entry_comments;
drop policy if exists "comments: own insert" on public.entry_comments;
drop policy if exists "comments: own or admin update" on public.entry_comments;
drop policy if exists "comments: own or admin delete" on public.entry_comments;
create policy "comments: permitted read" on public.entry_comments for select to authenticated
using (public.can_read_wiki_entry(entry_id));
create policy "comments: own insert" on public.entry_comments for insert to authenticated
with check (author_id = (select auth.uid()) and public.can_read_wiki_entry(entry_id) and
 exists(select 1 from public.entries e where e.id=entry_id and e.type <> 'access' and e.deleted_at is null));
create policy "comments: own or admin update" on public.entry_comments for update to authenticated
using (public.can_read_wiki_entry(entry_id) and (author_id = (select auth.uid()) or (select public.is_wiki_admin())))
with check (public.can_read_wiki_entry(entry_id) and (author_id = (select auth.uid()) or (select public.is_wiki_admin())));
create policy "comments: own or admin delete" on public.entry_comments for delete to authenticated
using (public.can_read_wiki_entry(entry_id) and (author_id = (select auth.uid()) or (select public.is_wiki_admin())));

-- Permanent removal is restricted to administrators and records already in trash.
grant delete on public.entries to authenticated;
drop policy if exists "entries: admin delete" on public.entries;
create policy "entries: admin delete" on public.entries for delete to authenticated
using (public.is_wiki_admin() and deleted_at is not null);
grant delete on public.entry_versions to authenticated;
drop policy if exists "entry versions: admin purge orphan" on public.entry_versions;
create policy "entry versions: admin purge orphan" on public.entry_versions for delete to authenticated
using (public.is_wiki_admin() and not exists(select 1 from public.entries e where e.id=entry_id));
create or replace function public.purge_wiki_entry(target_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare removed integer;
begin
  if not public.is_wiki_admin() then raise exception 'Administrator required'; end if;
  delete from public.entries where id=target_id and deleted_at is not null;
  get diagnostics removed = row_count;
  if removed=0 then return false; end if;
  delete from public.entry_versions where entry_id=target_id;
  return true;
end;
$$;
revoke all on function public.purge_wiki_entry(uuid) from public,anon;
grant execute on function public.purge_wiki_entry(uuid) to authenticated;

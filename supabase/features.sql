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

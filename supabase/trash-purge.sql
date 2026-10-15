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

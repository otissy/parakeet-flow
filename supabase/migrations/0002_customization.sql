-- Parakeet Flow customization sync (opt-in; see docs/sync-setup.md). Needs 0001_install_links.sql.
--
-- One row per group, or per install while it is not linked. `doc` holds the allowlisted customization
-- the app uploads (src/sync/allowlist.js): {"schema":1,"keys":{"<key>":{"v":...,"t":<ms>,"by":"<install id>"}}}.
-- Only the install itself, or the installs in its group, can read or change a row. Nothing here can
-- be reached with the public key alone: every grant is to signed-in installs, and RLS decides the row.
--
-- Safe to run again.

create table if not exists public.customization (
  id         bigint generated always as identity primary key,
  group_id   uuid unique references public.groups (id) on delete cascade,
  install_id uuid unique references public.installs (id) on delete cascade,
  doc        jsonb not null default '{}'::jsonb
             check (jsonb_typeof(doc) = 'object' and octet_length(doc::text) <= 2097152),
  version    bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.installs (id) on delete set null,
  constraint customization_one_owner check (num_nonnulls(group_id, install_id) = 1)
);
create index if not exists customization_updated_by_idx on public.customization (updated_by);

-- The database stamps every write, so a client cannot fake who wrote it, reset the version or move a row.
create or replace function private.customization_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    new.group_id := old.group_id;
    new.install_id := old.install_id;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function private.customization_stamp() from public, anon, authenticated;

drop trigger if exists customization_stamp on public.customization;
create trigger customization_stamp
  before insert or update on public.customization
  for each row execute function private.customization_stamp();

alter table public.customization enable row level security;

revoke all on public.customization from public, anon, authenticated;
grant select on public.customization to authenticated;
grant insert (group_id, install_id, doc) on public.customization to authenticated;
grant update (doc) on public.customization to authenticated;
-- no delete: a row goes away with its group or install (on delete cascade)

drop policy if exists customization_read on public.customization;
create policy customization_read on public.customization for select to authenticated
  using (
    install_id = (select auth.uid())
    or exists (select 1 from public.group_members gm
               where gm.group_id = customization.group_id and gm.install_id = (select auth.uid()))
  );

drop policy if exists customization_insert on public.customization;
create policy customization_insert on public.customization for insert to authenticated
  with check (
    install_id = (select auth.uid())
    or exists (select 1 from public.group_members gm
               where gm.group_id = customization.group_id and gm.install_id = (select auth.uid()))
  );

drop policy if exists customization_update on public.customization;
create policy customization_update on public.customization for update to authenticated
  using (
    install_id = (select auth.uid())
    or exists (select 1 from public.group_members gm
               where gm.group_id = customization.group_id and gm.install_id = (select auth.uid()))
  )
  with check (
    install_id = (select auth.uid())
    or exists (select 1 from public.group_members gm
               where gm.group_id = customization.group_id and gm.install_id = (select auth.uid()))
  );

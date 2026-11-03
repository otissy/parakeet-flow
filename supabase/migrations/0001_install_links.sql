-- Install identities and links for Parakeet Flow's optional customization sync (see docs/sync-setup.md).
--
-- Every install signs in anonymously (Supabase Auth "anonymous sign-ins"), so each install is one auth user and auth.uid() is its
-- install id. Installs link into a group with a short, single-use code. Access is enforced by Row Level Security, so the app only
-- ever holds the project's public key. Writes to groups, memberships and link codes go only through the SECURITY DEFINER functions
-- below, which check auth.uid() themselves.
--
-- Same design and object names as the sister tool parakeet-check, so one project can serve both; a project that already has them
-- skips this file. Run once in the Supabase SQL editor, then 0002_customization.sql. Safe to run again.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------- tables

create table if not exists public.installs (
  id         uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  name       text check (char_length(name) <= 80),
  machine    text check (char_length(machine) <= 80),
  version    text check (char_length(version) <= 40),
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid references public.installs (id) on delete set null,
  created_at timestamptz not null default now()
);

-- one group per install (the primary key), so "linked installs" is simply "same group"
create table if not exists public.group_members (
  install_id uuid primary key references public.installs (id) on delete cascade,
  group_id   uuid not null references public.groups (id) on delete cascade,
  joined_at  timestamptz not null default now()
);
create index if not exists group_members_group_idx on public.group_members (group_id);

create table if not exists public.link_codes (
  code       text primary key check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  created_by uuid not null references public.installs (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  used_by    uuid references public.installs (id) on delete set null
);
create index if not exists link_codes_creator_idx on public.link_codes (created_by, created_at);

-- failed join attempts, to rate-limit guessing codes
create table if not exists private.link_attempts (
  install_id uuid not null,
  at         timestamptz not null default now()
);
create index if not exists link_attempts_idx on private.link_attempts (install_id, at);

-- ---------------------------------------------------------------- helpers

-- true when `other` is the caller or shares a group with the caller. SECURITY DEFINER so policies
-- can use it without recursing into group_members' own policies.
create or replace function private.visible_install(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select other = auth.uid()
      or exists (
        select 1
        from public.group_members a
        join public.group_members b on b.group_id = a.group_id
        where a.install_id = auth.uid() and b.install_id = other
      );
$$;
revoke all on function private.visible_install(uuid) from public, anon;
grant execute on function private.visible_install(uuid) to authenticated;

-- 6 characters from an alphabet without 0/O, 1/I/L; rejection sampling keeps it unbiased
create or replace function private.new_link_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- 31 characters
  bytes bytea;
  b int;
  result text := '';
begin
  while char_length(result) < 6 loop
    bytes := uuid_send(gen_random_uuid());
    -- bytes 6 and 8 carry the UUID version/variant bits: skip them
    for i in 0..15 loop
      continue when i in (6, 8);
      b := get_byte(bytes, i);
      continue when b >= 248; -- 248 = 8 * 31
      result := result || substr(alphabet, (b % 31) + 1, 1);
      exit when char_length(result) = 6;
    end loop;
  end loop;
  return result;
end;
$$;
revoke all on function private.new_link_code() from public, anon, authenticated;

create or replace function private.normalize_code(raw text)
returns text
language sql
immutable
set search_path = ''
as $$ select upper(regexp_replace(coalesce(raw, ''), '[\s-]', '', 'g')); $$;
revoke all on function private.normalize_code(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- functions the client calls

-- A new single-use code (10 minutes) that another install can join this install's group with.
-- Replaces the caller's earlier unused codes. At most 20 codes per install per hour.
create or replace function public.create_link_code()
returns table (code text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  new_code text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.installs i where i.id = me) then
    raise exception 'install not registered';
  end if;
  if (select count(*) from public.link_codes c
      where c.created_by = me and c.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too many link codes this hour, try again later';
  end if;

  delete from public.link_codes c where c.expires_at < now() - interval '1 day';
  delete from public.link_codes c where c.created_by = me and c.used_at is null;
  delete from private.link_attempts a where a.at < now() - interval '1 day';

  loop
    new_code := private.new_link_code();
    exit when not exists (select 1 from public.link_codes c where c.code = new_code);
  end loop;

  insert into public.link_codes (code, created_by, expires_at)
  values (new_code, me, now() + interval '10 minutes');

  return query select new_code, now() + interval '10 minutes';
end;
$$;

-- Join the group of the install that created `raw_code` (creating that group on first use).
-- Leaves the caller's previous group. Returns {"ok": true, "group_id": ...} or
-- {"ok": false, "error": "..."}; errors are returned, not raised, so a failed attempt is recorded
-- (10 failed attempts per 10 minutes, then joining is refused for a while).
create or replace function public.join_with_code(raw_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  c text := private.normalize_code(raw_code);
  rec public.link_codes%rowtype;
  target uuid;
  previous uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.installs i where i.id = me) then
    return jsonb_build_object('ok', false, 'error', 'install not registered');
  end if;
  if (select count(*) from private.link_attempts a
      where a.install_id = me and a.at > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'too many wrong codes, wait 10 minutes');
  end if;

  select * into rec from public.link_codes l where l.code = c for update;
  if not found or rec.used_at is not null or rec.expires_at <= now() then
    insert into private.link_attempts (install_id) values (me);
    return jsonb_build_object('ok', false, 'error', 'invalid, used or expired code');
  end if;
  if rec.created_by = me then
    return jsonb_build_object('ok', false, 'error', 'that is this install''s own code: join it from another install');
  end if;

  select gm.group_id into target from public.group_members gm where gm.install_id = rec.created_by;
  if target is null then
    insert into public.groups (created_by) values (rec.created_by) returning id into target;
    insert into public.group_members (install_id, group_id) values (rec.created_by, target);
  end if;

  select gm.group_id into previous from public.group_members gm where gm.install_id = me;
  if previous is distinct from target then
    delete from public.group_members gm where gm.install_id = me;
    if previous is not null
       and (select count(*) from public.group_members gm where gm.group_id = previous) < 2 then
      delete from public.groups g where g.id = previous;
    end if;
    insert into public.group_members (install_id, group_id) values (me, target);
  end if;

  update public.link_codes l set used_at = now(), used_by = me where l.code = c;
  return jsonb_build_object('ok', true, 'group_id', target);
end;
$$;

-- Leave the caller's group. A group left with fewer than two members is removed.
create or replace function public.leave_group()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  previous uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  select gm.group_id into previous from public.group_members gm where gm.install_id = me;
  if previous is null then return; end if;
  delete from public.group_members gm where gm.install_id = me;
  if (select count(*) from public.group_members gm where gm.group_id = previous) < 2 then
    delete from public.groups g where g.id = previous;
  end if;
end;
$$;

-- The caller and every install linked with it.
create or replace function public.list_group()
returns table (install_id uuid, name text, machine text, version text, joined_at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.name, i.machine, i.version, gm.joined_at, i.id = auth.uid()
  from public.installs i
  left join public.group_members gm on gm.install_id = i.id
  where private.visible_install(i.id)
  order by gm.joined_at nulls first;
$$;

revoke all on function public.create_link_code() from public, anon;
revoke all on function public.join_with_code(text) from public, anon;
revoke all on function public.leave_group() from public, anon;
revoke all on function public.list_group() from public, anon;
grant execute on function public.create_link_code() to authenticated;
grant execute on function public.join_with_code(text) to authenticated;
grant execute on function public.leave_group() to authenticated;
grant execute on function public.list_group() to authenticated;

-- ---------------------------------------------------------------- row level security

alter table public.installs      enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.link_codes    enable row level security;
alter table private.link_attempts enable row level security;

revoke all on public.installs, public.groups, public.group_members, public.link_codes
  from anon, authenticated;
revoke all on private.link_attempts from public, anon, authenticated;

grant select, insert, update on public.installs to authenticated;
grant select on public.groups, public.group_members to authenticated;
-- link_codes: no grants at all; only the functions above touch it

drop policy if exists installs_read on public.installs;
create policy installs_read on public.installs for select to authenticated
  using (private.visible_install(id));
drop policy if exists installs_insert on public.installs;
create policy installs_insert on public.installs for insert to authenticated
  with check (id = auth.uid());
drop policy if exists installs_update on public.installs;
create policy installs_update on public.installs for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups for select to authenticated
  using (exists (select 1 from public.group_members gm
                 where gm.group_id = groups.id and gm.install_id = auth.uid()));

drop policy if exists group_members_read on public.group_members;
create policy group_members_read on public.group_members for select to authenticated
  using (private.visible_install(install_id));

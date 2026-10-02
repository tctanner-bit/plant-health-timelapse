-- Plant Health AI moves into Growlink LABS (labs.growlink.io/plant-health/).
--
-- People sign in with their LABS account (Supabase Auth in the LABS project,
-- mgenmllmciiijyeielak); this project only stores their LABS user id. A site
-- is one Growlink organization connected once by an owner with an org-admin
-- API key, kept in Vault and read only by the server. Teammates join as
-- owners or viewers by invitation (matched on their verified LABS email).
-- Cameras, frames and insights stay keyed by the Growlink org id.

create table public.sites (
  id                 uuid primary key default gen_random_uuid(),
  growlink_org_id    uuid not null unique,
  name               text not null,
  key_secret_id      uuid,                        -- vault.secrets id
  key_hint           text,                        -- last 4 characters
  key_status         text not null default 'missing' check (key_status in ('ok', 'rejected', 'missing')),
  key_error          text,
  key_checked_at     timestamptz,
  monitoring_enabled boolean not null default true,  -- background Nova
  tz                 text,                        -- IANA zone, from members' browsers
  created_by         uuid not null,               -- LABS user id
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.site_members (
  site_id   uuid not null references public.sites(id) on delete cascade,
  user_id   uuid not null,                        -- LABS user id
  email     text,
  role      text not null check (role in ('owner', 'viewer')),
  added_by  uuid,
  added_at  timestamptz not null default now(),
  primary key (site_id, user_id)
);
create index site_members_user_idx on public.site_members (user_id);

create table public.site_invites (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.sites(id) on delete cascade,
  email      text not null check (email = lower(email)),
  role       text not null check (role in ('owner', 'viewer')),
  invited_by uuid not null,
  created_at timestamptz not null default now(),
  unique (site_id, email)
);
create index site_invites_email_idx on public.site_invites (email);

-- The site's Growlink key in Vault. Service role only.
create or replace function public.set_site_key(p_site uuid, p_key text, p_hint text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  select key_secret_id into v_id from sites where id = p_site for update;
  if v_id is null then
    v_id := vault.create_secret(p_key, 'growlink_key:' || p_site::text, 'Plant Health AI site key');
  else
    perform vault.update_secret(v_id, p_key);
  end if;
  update sites
     set key_secret_id = v_id, key_hint = p_hint, key_status = 'ok', key_error = null,
         key_checked_at = now(), updated_at = now()
   where id = p_site;
end;
$$;

create or replace function public.get_site_key(p_site uuid)
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select d.decrypted_secret
  from sites s join vault.decrypted_secrets d on d.id = s.key_secret_id
  where s.id = p_site;
$$;

create or replace function public.clear_site_key(p_site uuid, p_status text, p_error text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  select key_secret_id into v_id from sites where id = p_site for update;
  if v_id is not null then
    delete from vault.secrets where id = v_id;
  end if;
  update sites
     set key_secret_id = null, key_hint = null, key_status = p_status, key_error = p_error,
         key_checked_at = now(), updated_at = now()
   where id = p_site;
end;
$$;

revoke all on function public.set_site_key(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_site_key(uuid) from public, anon, authenticated;
revoke all on function public.clear_site_key(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_site_key(uuid, text, text) to service_role;
grant execute on function public.get_site_key(uuid) to service_role;
grant execute on function public.clear_site_key(uuid, text, text) to service_role;

alter table public.sites enable row level security;
alter table public.site_members enable row level security;
alter table public.site_invites enable row level security;

-- Small copies of each frame (~640 px) for tiles and playback.
alter table public.camera_frames add column small_path text;
alter table public.camera_frames add column small_bytes int;
create index camera_frames_needs_small_idx on public.camera_frames (captured_at desc) where small_path is null;

drop function public.latest_frames(uuid);
create function public.latest_frames(p_org uuid)
returns table (camera_id uuid, frame_id bigint, captured_at timestamptz, storage_path text, small_path text)
language sql
stable
set search_path = public
as $$
  select c.id, f.id, f.captured_at, f.storage_path, f.small_path
  from cameras c
  cross join lateral (
    select id, captured_at, storage_path, small_path
    from camera_frames
    where camera_id = c.id
    order by captured_at desc
    limit 1
  ) f
  where c.org_id = p_org;
$$;
revoke all on function public.latest_frames(uuid) from public, anon, authenticated;
grant execute on function public.latest_frames(uuid) to service_role;

-- Replaced by sites (key in Vault, monitoring flag, time zone). It never held a key.
drop table public.org_monitoring;

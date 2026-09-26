-- Camera fleet dashboard (/admin) for Growlink support.
--
-- Staff sign in with Supabase Auth; the email must also be in fleet_admins.
-- Admin data is served only by server routes (service role) that check
-- both — no RLS policies here, so nothing is reachable with the public key.

create table public.fleet_admins (
  email      text primary key check (email = lower(email)),
  added_at   timestamptz not null default now(),
  added_by   text
);

-- Every support action, who did it, and what changed.
create table public.fleet_audit (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  admin_email text not null,
  camera_id   uuid references public.cameras (id) on delete set null,
  action      text not null,
  detail      jsonb not null default '{}'::jsonb
);
create index fleet_audit_camera_idx on public.fleet_audit (camera_id, at desc);
create index fleet_audit_at_idx on public.fleet_audit (at desc);

-- Names shown to support, captured when a customer claims or moves a camera
-- (the server has them from Growlink at that moment). Support notes too.
alter table public.cameras
  add column org_name  text,
  add column room_name text,
  add column notes     text;

alter table public.fleet_admins enable row level security;
alter table public.fleet_audit  enable row level security;

-- One row per camera with the health numbers the fleet list needs.
create or replace function public.fleet_overview()
returns table (
  id uuid, serial text, name text, org_id uuid, org_name text, room_id uuid, room_name text,
  interval_sec int, provisioned_at timestamptz, claimed_at timestamptz, revoked_at timestamptz,
  last_seen_at timestamptz, last_frame_at timestamptz, last_error text, last_error_at timestamptz,
  notes text, frames_24h bigint, frames_7d bigint, nova_insights_30d bigint, nova_cost_30d numeric
)
language sql
stable
set search_path = public
as $$
  select c.id, c.serial, c.name, c.org_id, c.org_name, c.room_id, c.room_name,
         c.interval_sec, c.provisioned_at, c.claimed_at, c.revoked_at,
         c.last_seen_at, c.last_frame_at, c.last_error, c.last_error_at, c.notes,
         (select count(*) from camera_frames f where f.camera_id = c.id and f.captured_at > now() - interval '24 hours'),
         (select count(*) from camera_frames f where f.camera_id = c.id and f.captured_at > now() - interval '7 days'),
         (select count(*) from camera_insights i where i.camera_id = c.id and i.status = 'ready' and i.created_at > now() - interval '30 days'),
         (select coalesce(sum(i.cost_usd), 0) from camera_insights i where i.camera_id = c.id and i.created_at > now() - interval '30 days')
  from cameras c;
$$;

-- Frames per hour for one camera, for the uptime timeline.
create or replace function public.camera_hourly(p_camera uuid, p_days int default 7)
returns table (hour timestamptz, frames bigint)
language sql
stable
set search_path = public
as $$
  select date_trunc('hour', captured_at) as hour, count(*)
  from camera_frames
  where camera_id = p_camera and captured_at > now() - make_interval(days => least(greatest(p_days, 1), 31))
  group by 1
  order by 1;
$$;

-- Nova usage by org and day, from each insight's recorded cost.
create or replace function public.nova_usage_daily(p_days int default 30)
returns table (day date, org_id uuid, org_name text, insights bigint, daily_reviews bigint, moments bigint, failed bigint, cost_usd numeric)
language sql
stable
set search_path = public
as $$
  select date_trunc('day', i.created_at)::date, i.org_id, max(c.org_name),
         count(*) filter (where i.status = 'ready'),
         count(*) filter (where i.status = 'ready' and i.kind = 'daily'),
         count(*) filter (where i.status = 'ready' and i.kind = 'moment'),
         count(*) filter (where i.status = 'failed'),
         coalesce(sum(i.cost_usd), 0)
  from camera_insights i
  left join cameras c on c.id = i.camera_id
  where i.created_at > now() - make_interval(days => least(greatest(p_days, 1), 366))
  group by 1, 2
  order by 1 desc, 8 desc;
$$;

revoke all on function public.fleet_overview() from public, anon, authenticated;
revoke all on function public.camera_hourly(uuid, int) from public, anon, authenticated;
revoke all on function public.nova_usage_daily(int) from public, anon, authenticated;
grant execute on function public.fleet_overview() to service_role;
grant execute on function public.camera_hourly(uuid, int) to service_role;
grant execute on function public.nova_usage_daily(int) to service_role;

insert into public.fleet_admins (email, added_by) values ('tctanner@gmail.com', 'bootstrap');

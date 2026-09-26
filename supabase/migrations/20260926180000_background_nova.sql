-- Background Nova: watchers every 5 minutes (no AI) that look at each
-- camera's newest frame and its room's live sensors, and queue a Nova review
-- when something trips; plus the daily review, run server-side.

-- Per org: may the server watch in the background, and the org's Growlink
-- key for read-only sensor calls, AES-256-GCM encrypted with a key that lives
-- only in Vercel (CREDENTIALS_KEY). Captured when someone uses the app.
create table public.org_monitoring (
  org_id         uuid primary key,
  enabled        boolean not null default true,
  key_ciphertext text,
  key_hash       text,          -- sha256 of the key, to skip rewriting the same one
  key_hint       text,          -- last 4 characters, for support
  tz             text,          -- viewer's IANA time zone, for the daily review
  stored_at      timestamptz,
  last_used_at   timestamptz,
  last_error     text,
  last_error_at  timestamptz,
  updated_at     timestamptz not null default now()
);

-- Small per-frame measurements for comparisons (lights, visual change).
create table public.camera_frame_stats (
  frame_id    bigint primary key references public.camera_frames(id) on delete cascade,
  camera_id   uuid not null references public.cameras(id) on delete cascade,
  captured_at timestamptz not null,
  brightness  real not null,       -- mean luma 0–255
  ir          boolean not null,    -- grey-scale (night / infrared)
  thumb       text not null        -- 32×18 luma, base64
);
create index camera_frame_stats_camera_time_idx on public.camera_frame_stats (camera_id, captured_at desc);

-- Watcher state per camera: what it last looked at, conditions waiting for a
-- second look, recent readings, cooldowns.
create table public.camera_watch (
  camera_id     uuid primary key references public.cameras(id) on delete cascade,
  last_run_at   timestamptz,
  last_frame_id bigint,
  state         jsonb not null default '{}'::jsonb
);

-- Every trip, whether or not Nova ran (for tuning thresholds).
create table public.camera_events (
  id          bigint generated always as identity primary key,
  camera_id   uuid not null references public.cameras(id) on delete cascade,
  org_id      uuid not null,
  kind        text not null,
  detail      jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now(),
  insight_id  uuid
);
create index camera_events_camera_time_idx on public.camera_events (camera_id, at desc);

-- One worker at a time.
create table public.job_locks (
  name         text primary key,
  locked_until timestamptz not null default 'epoch'
);
insert into public.job_locks (name) values ('watch');

-- Insights: queued (waiting for the Nova worker) and alert (from a trigger).
alter table public.camera_insights drop constraint camera_insights_status_check;
alter table public.camera_insights
  add constraint camera_insights_status_check check (status in ('queued', 'running', 'ready', 'failed'));
alter table public.camera_insights drop constraint camera_insights_kind_check;
alter table public.camera_insights
  add constraint camera_insights_kind_check check (kind in ('daily', 'moment', 'range', 'alert'));
alter table public.camera_insights add column trigger jsonb;
alter table public.camera_insights add column started_at timestamptz;

-- The Nova worker takes the oldest queued job (or one stuck running).
create or replace function public.claim_insight_job()
returns setof public.camera_insights
language sql
set search_path = public
as $$
  update camera_insights set status = 'running', started_at = now()
  where id = (
    select id from camera_insights
    where status = 'queued'
       or (status = 'running' and kind in ('daily', 'alert') and started_at < now() - interval '5 minutes')
    order by created_at
    limit 1
    for update skip locked
  )
  returning *;
$$;

alter table public.org_monitoring enable row level security;
alter table public.camera_frame_stats enable row level security;
alter table public.camera_watch enable row level security;
alter table public.camera_events enable row level security;
alter table public.job_locks enable row level security;
revoke all on function public.claim_insight_job() from public, anon, authenticated;
grant execute on function public.claim_insight_job() to service_role;

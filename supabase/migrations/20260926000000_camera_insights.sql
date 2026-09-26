-- Nova insights: the vision model's read of a camera's frames against its
-- sensor history. Written server-side only (service role), shared by
-- everyone in the org, so each analysis runs once rather than per viewer.
--
--   kind = 'daily'  — one per camera per day (viewer's local day), made the
--                     first time someone opens the camera after that day.
--   kind = 'moment' — on demand, about one frame (and an optional question).

create table public.camera_insights (
  id              uuid primary key default gen_random_uuid(),
  camera_id       uuid not null references public.cameras (id) on delete cascade,
  org_id          uuid not null,
  kind            text not null check (kind in ('daily', 'moment')),
  period_start    timestamptz not null,
  period_end      timestamptz not null,
  day_label       text,                        -- 'yyyy-mm-dd' in the requester's time zone (daily)
  question        text,                        -- moment only
  status          text not null default 'running' check (status in ('running', 'ready', 'failed')),
  headline        text,
  concern         text check (concern in ('none', 'watch', 'action')),
  observations    jsonb not null default '[]'::jsonb,
  suggestions     jsonb not null default '[]'::jsonb,
  frames          jsonb not null default '[]'::jsonb,  -- [{ id, ts, role }]
  sensor_summary  jsonb,
  model           text,
  error           text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

-- One daily insight per camera per day, even if several viewers trigger it at once.
create unique index camera_insights_daily_uniq
  on public.camera_insights (camera_id, day_label) where kind = 'daily';
create index camera_insights_camera_idx on public.camera_insights (camera_id, created_at desc);
create index camera_insights_org_idx on public.camera_insights (org_id, created_at desc);

alter table public.camera_insights enable row level security;

-- Newest finished insight per camera in an org, for the facility view.
create or replace function public.latest_insights(p_org uuid)
returns table (camera_id uuid, insight_id uuid, kind text, concern text, headline text, created_at timestamptz)
language sql
stable
set search_path = public
as $$
  select c.id, i.id, i.kind, i.concern, i.headline, i.created_at
  from cameras c
  cross join lateral (
    select id, kind, concern, headline, created_at
    from camera_insights
    where camera_id = c.id and status = 'ready'
    order by created_at desc
    limit 1
  ) i
  where c.org_id = p_org;
$$;

revoke all on function public.latest_insights(uuid) from public, anon, authenticated;
grant execute on function public.latest_insights(uuid) to service_role;

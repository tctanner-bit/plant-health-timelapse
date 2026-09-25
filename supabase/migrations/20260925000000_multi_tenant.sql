-- Multi-tenant cameras + frames.
--
-- Tenant = Growlink organization. org_id / room_id are Growlink GUIDs; there is
-- no local tenants table because Growlink is the source of truth for who
-- belongs to which org.
--
-- Nothing here is readable with the publishable key. RLS is on with no
-- policies, so only the service role (Next.js API routes, ingest-frame edge
-- function) can touch these tables — both check tenancy before they do.
--
-- The single-tenant prototype (public.frames + the public `frames` bucket) is
-- left untouched here; see supabase/cleanup_prototype.sql.

create table public.cameras (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  room_id           uuid not null,
  name              text not null check (length(name) between 1 and 80),
  interval_sec      int  not null default 300 check (interval_sec between 60 and 86400),
  -- sha256 hex of the camera's ingest token. The token itself is shown once.
  ingest_token_hash text not null unique,
  token_hint        text not null,           -- last 4 chars, to tell tokens apart
  created_at        timestamptz not null default now(),
  last_frame_at     timestamptz,
  last_seen_at      timestamptz,             -- any contact from the capture agent
  last_error        text,
  last_error_at     timestamptz,
  revoked_at        timestamptz
);
create index cameras_org_idx on public.cameras (org_id);

create table public.camera_frames (
  id           bigint generated always as identity primary key,
  camera_id    uuid not null references public.cameras (id) on delete cascade,
  org_id       uuid not null,
  captured_at  timestamptz not null,
  storage_path text not null unique,
  bytes        int,
  created_at   timestamptz not null default now()
);
create index camera_frames_camera_time_idx on public.camera_frames (camera_id, captured_at);

alter table public.cameras       enable row level security;
alter table public.camera_frames enable row level security;

-- Private bucket, JPEG only. Paths: {org_id}/{camera_id}/YYYY/MM/DD/{stamp}.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('camera-frames', 'camera-frames', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

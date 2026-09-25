-- Latest frame for every camera in an org, in one round trip — the facility
-- view shows 12–40 of these at once. Uses camera_frames_camera_time_idx, one
-- index probe per camera. Server-side only (service role); nothing else may
-- call it.
create or replace function public.latest_frames(p_org uuid)
returns table (camera_id uuid, frame_id bigint, captured_at timestamptz, storage_path text)
language sql
stable
set search_path = public
as $$
  select c.id, f.id, f.captured_at, f.storage_path
  from cameras c
  cross join lateral (
    select id, captured_at, storage_path
    from camera_frames
    where camera_id = c.id
    order by captured_at desc
    limit 1
  ) f
  where c.org_id = p_org;
$$;

revoke all on function public.latest_frames(uuid) from public, anon, authenticated;
grant execute on function public.latest_frames(uuid) to service_role;

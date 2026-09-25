-- Plug-and-play cameras.
--
-- Cameras are provisioned at the warehouse with no organization: the unit
-- gets an FTP login (its ingest token) and a claim code printed on a sticker.
-- The customer plugs it in, enters the sticker code in the app, and picks a
-- room — that sets org_id/room_id. Until then the camera can check in (so the
-- app can show "online" while claiming) but its frames are not stored.

alter table public.cameras
  alter column org_id  drop not null,
  alter column room_id drop not null,
  add column serial          text unique,          -- from the camera label, for support lookups
  add column ftp_username    text unique,          -- what the camera logs in as
  add column claim_code_hash text unique,          -- sha256 of the sticker code; cleared on claim
  add column claimed_at      timestamptz,
  add column provisioned_at  timestamptz not null default now();

-- Claimed means both org and room are known; unclaimed means neither.
alter table public.cameras
  add constraint cameras_claim_consistent check (
    (org_id is null and room_id is null and claimed_at is null)
    or (org_id is not null and room_id is not null and claimed_at is not null)
  );

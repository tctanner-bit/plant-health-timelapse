-- Which Growlink sensors appear alongside a camera's timelapse, in display
-- order: a JSON array of sensor GUIDs, all from the camera's own room.
-- Chosen explicitly per camera (shared by everyone in the org) rather than
-- guessed. Names and metrics aren't stored; the player reads them fresh from
-- Growlink, so renames show up automatically. Cleared when the camera moves
-- to another room.

alter table public.cameras
  add column sensors jsonb not null default '[]'::jsonb
    check (jsonb_typeof(sensors) = 'array' and jsonb_array_length(sensors) <= 20);

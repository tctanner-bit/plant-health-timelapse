-- Run by hand in the Supabase SQL editor once you're sure the prototype data
-- (621 frames from flower-room-01, Jun 13–26 2026) isn't needed.
--
-- 1. Close the public read access the prototype opened.
drop policy if exists "public can read frames" on public.frames;
drop policy if exists "service can write frames table" on public.frames;
drop policy if exists "public can read frame objects" on storage.objects;
drop policy if exists "service can read frames" on storage.objects;
drop policy if exists "service can write frames" on storage.objects;
update storage.buckets set public = false where id = 'frames';

-- 2. Drop the prototype table.
drop table if exists public.frames;

-- 3. Empty and delete the old `frames` bucket from the dashboard
--    (Storage → frames → Empty bucket, then Delete bucket). Storage objects
--    can't be deleted with SQL.

-- Background Nova jobs need a shared secret (security audit 2026-10-20).
--
-- /plant-health/api/jobs/watch/ and /jobs/nova/ were callable by anyone; each
-- Nova call costs an AI request. The routes now require the header
-- x-jobs-secret to match the server-only Vercel env var JOBS_SECRET.
-- The secret lives in Vault as 'phai_jobs_secret' (create it before this runs:
-- select vault.create_secret('<random 64 hex>', 'phai_jobs_secret', '…');
-- then set the same value as JOBS_SECRET in Vercel → Production). pg_cron
-- reads it from Vault on every run, so rotating it is: update the Vault
-- secret, update the Vercel env var, redeploy.
select cron.unschedule('phai-watch');
select cron.unschedule('phai-nova');
select cron.schedule(
  'phai-watch',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://timelapse-web-six.vercel.app/plant-health/api/jobs/watch/',
       headers := jsonb_build_object('Content-Type', 'application/json',
         'x-jobs-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'phai_jobs_secret')),
       body := '{}'::jsonb,
       timeout_milliseconds := 60000) $$
);
select cron.schedule(
  'phai-nova',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://timelapse-web-six.vercel.app/plant-health/api/jobs/nova/',
       headers := jsonb_build_object('Content-Type', 'application/json',
         'x-jobs-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'phai_jobs_secret')),
       body := '{}'::jsonb,
       timeout_milliseconds := 60000) $$
);

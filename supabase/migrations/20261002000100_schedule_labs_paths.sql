-- The app now builds with basePath /plant-health (served in Growlink LABS);
-- point the background Nova schedule at the new job routes.
select cron.unschedule('phai-watch');
select cron.unschedule('phai-nova');
select cron.schedule(
  'phai-watch',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://timelapse-web-six.vercel.app/plant-health/api/jobs/watch/',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 60000) $$
);
select cron.schedule(
  'phai-nova',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://timelapse-web-six.vercel.app/plant-health/api/jobs/nova/',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 60000) $$
);

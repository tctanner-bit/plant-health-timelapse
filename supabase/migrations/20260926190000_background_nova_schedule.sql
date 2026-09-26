-- Background Nova schedule: the database calls the app's job routes.
--   phai-watch  every 5 minutes: watchers + queue daily/alert reviews
--   phai-nova   every minute:    run one queued Nova review
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'phai-watch',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://timelapse-web-six.vercel.app/api/jobs/watch',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 60000) $$
);

select cron.schedule(
  'phai-nova',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://timelapse-web-six.vercel.app/api/jobs/nova',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 60000) $$
);

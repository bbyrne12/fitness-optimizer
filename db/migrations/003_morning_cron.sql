-- Reliable trigger for the morning email.
--
-- GitHub Actions was the poller, but scheduled workflows on a free public repo
-- are best-effort: in the first 34 hours it fired 2 of ~32 scheduled runs. On
-- 2026-09-12 the single run landed at 12:44 UTC and WHOOP did not score the
-- recovery until 13:11 UTC, so it correctly reported "waiting" and no second
-- poll ever came. No email that day.
--
-- pg_cron runs inside the database on a real scheduler, so it actually fires.
-- Paste this into the Supabase SQL editor with the two values filled in.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Safe to re-run: drops the old job before creating it.
select cron.unschedule('athlete-os-morning')
where exists (select 1 from cron.job where jobname = 'athlete-os-morning');

select cron.schedule(
  'athlete-os-morning',
  -- Every 20 minutes, 09:00-16:59 UTC = 05:00-12:59 America/New_York in DST.
  -- His wake time swings 5:15 to 9:43 and recovery scores a median of 13
  -- minutes later, so the window has to be wide and the interval short.
  '*/20 9-16 * * *',
  $job$
    select net.http_get(
      url     := 'https://REPLACE_WITH_YOUR_APP.vercel.app/api/morning',
      headers := jsonb_build_object('Authorization', 'Bearer REPLACE_WITH_CRON_SECRET'),
      timeout_milliseconds := 55000
    );
  $job$
);

-- Check it registered:
--   select jobid, jobname, schedule, active from cron.job;
-- Check what it has actually done (the route's own reply is in the response):
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select id, created, status_code, content::text
--     from net._http_response order by created desc limit 20;

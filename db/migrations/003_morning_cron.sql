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
  -- Every 20 minutes, 09:00-18:59 UTC. Set the hours to cover the athlete's
  -- mornings in their own time zone. Waking time varies by hours and recovery
  -- scores shortly after, so the window has to be wide and the interval short.
  --
  -- It has to outlast the hold as well as the wake. A broken night is held
  -- until four hours past the usual wake, capped at one in the afternoon
  -- local time, and the decision is only sent by a poll -- so if the window
  -- closes before that deadline, the email is not late, it never comes. One
  -- in the afternoon is 17:00 UTC on US eastern summer time and 18:00 on
  -- winter time, which is what the last hour here is for.
  '*/20 9-18 * * *',
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

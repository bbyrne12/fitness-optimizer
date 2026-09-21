-- The demo account: plan writable, history not.
--
-- The login goes in a job application, so strangers will use it, and a demo
-- you cannot touch is a screenshot. They should be able to do the thing the
-- app is actually for -- argue with the coach, move the long run, add a sport,
-- change the setup answers -- and be unable to leave the next reviewer a
-- broken version of it.
--
-- The line is between the plan and the record:
--
--   athlete_profile  writable. It is the plan, and changing it is the demo.
--   athlete_sets     locked. Eight weeks of logged lifts are what the engine
--                    learned from; delete them and the app has nothing to say.
--   plans, routines, workout_logs, profiles  locked, same reason.
--   whoop_tokens, decision_log  already unreachable from any session: both
--                    are written server-side with the service role only. So a
--                    reviewer cannot attach their own WHOOP to the demo.
--
-- The plan is put back every night from a copy kept out of reach
-- (demo_baseline, below, which only the service role can read), so whatever
-- the last person did is gone by morning.
--
-- Enforced in the database rather than the app because there are a dozen
-- places that write. The service role is unaffected (auth.uid() is null
-- there), so the seeder and the nightly restore still work.
--
-- The account marks itself: athlete_profile.config->>'demo' = 'true', set by
-- scripts/seed-demo.ts. Nothing here names a person or an address.

-- ------------------------------------------------------- who is the demo
-- Owner-rights so the lookup does not re-enter the policies that call it.
create or replace function public.is_demo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.config->>'demo' = 'true'
       from athlete_profile p where p.user_id = auth.uid()), false)
$$;

revoke all on function public.is_demo() from public;
grant execute on function public.is_demo() to authenticated;

-- --------------------------------------------------- the pristine plan
-- Kept in its own table rather than inside the profile, so that the session
-- allowed to change the plan is not also the session holding the copy it
-- gets restored from. Row-level security on, and deliberately no policies:
-- no signed-in user reaches this at all, only the service role.
create table if not exists demo_baseline (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  config   jsonb not null,
  saved_at timestamptz not null default now()
);
alter table demo_baseline enable row level security;

-- ---------------------------------------------------------- athlete_sets
-- What was actually trained. The demo reads it and changes nothing.
drop policy if exists "own sets"    on athlete_sets;
drop policy if exists "read sets"   on athlete_sets;
drop policy if exists "add sets"    on athlete_sets;
drop policy if exists "edit sets"   on athlete_sets;
drop policy if exists "remove sets" on athlete_sets;

create policy "read sets" on athlete_sets for select to authenticated
  using (auth.uid() = user_id);
create policy "add sets" on athlete_sets for insert to authenticated
  with check (auth.uid() = user_id and not public.is_demo());
create policy "edit sets" on athlete_sets for update to authenticated
  using (auth.uid() = user_id and not public.is_demo())
  with check (auth.uid() = user_id and not public.is_demo());
create policy "remove sets" on athlete_sets for delete to authenticated
  using (auth.uid() = user_id and not public.is_demo());

-- ------------------------------------- the rest, where the tables exist
-- plans, routines, workout_logs and profiles come from the earlier app.
do $$
declare t text;
begin
  foreach t in array array['plans', 'routines', 'workout_logs', 'profiles'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    -- Restrictive, and never on select: reads stay exactly as they were, and
    -- each write has to satisfy this as well as the table's own policy.
    execute format('drop policy if exists %I on public.%I', 'demo adds nothing', t);
    execute format('drop policy if exists %I on public.%I', 'demo changes nothing', t);
    execute format('drop policy if exists %I on public.%I', 'demo removes nothing', t);
    execute format('create policy %I on public.%I as restrictive for insert to authenticated '
                   'with check (not public.is_demo())', 'demo adds nothing', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated '
                   'using (not public.is_demo()) with check (not public.is_demo())',
                   'demo changes nothing', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated '
                   'using (not public.is_demo())', 'demo removes nothing', t);
  end loop;
end $$;

-- athlete_profile is left exactly as 004 wrote it -- each athlete may change
-- their own row, the demo included. That is the point of this migration.

-- ------------------------------------------------------ the nightly undo
-- Put the plan back from demo_baseline every night. Fill in the two values
-- and run this part separately; the secret is not in the repository.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

select cron.unschedule('demo-reset')
where exists (select 1 from cron.job where jobname = 'demo-reset');

select cron.schedule(
  'demo-reset',
  -- 08:00 UTC, before anyone in the US is awake to read the application.
  '0 8 * * *',
  $job$
    select net.http_get(
      url     := 'https://REPLACE_WITH_YOUR_APP.vercel.app/api/demo/reset',
      headers := jsonb_build_object('Authorization', 'Bearer REPLACE_WITH_CRON_SECRET'),
      timeout_milliseconds := 30000
    );
  $job$
);

-- Check it, signed in as the demo athlete:
--   select public.is_demo();            -- true for them, false for everyone else
--   update athlete_profile set updated_at = now();   -- 1 row: the plan is theirs
--   insert into athlete_sets (user_id, day, exercise, sets)
--     values (auth.uid(), current_date, 'test', 1);  -- row-level security error
--   select * from demo_baseline;        -- 0 rows, even though one exists
-- And as any other athlete, that insert still works.

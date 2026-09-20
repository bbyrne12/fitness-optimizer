-- The demo account, read-only.
--
-- The login goes in a job application, so strangers will use it. They should
-- be able to click through everything -- the plan, the journal, the coach --
-- and be unable to leave the next reviewer a broken version of it.
--
-- Enforced in the database rather than in the app, because there are a dozen
-- places that write and only one that matters: no session belonging to the
-- demo athlete may insert, update or delete anything. The service role is
-- unaffected (auth.uid() is null there), so the seeder still rebuilds it.
--
-- The account marks itself: athlete_profile.config->>'demo' = 'true', set by
-- scripts/seed-demo.ts. Nothing here names a person or an address.

-- Owner-rights so the lookup does not re-enter the policies that call it.
create or replace function public.is_demo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.config->>'demo' = 'true'
       from athlete_profile p where p.user_id = auth.uid()), false)
$$;

revoke all on function public.is_demo() from public;
grant execute on function public.is_demo() to authenticated;

-- ------------------------------------------------------- athlete_profile
drop policy if exists "own profile"    on athlete_profile;
drop policy if exists "read profile"   on athlete_profile;
drop policy if exists "add profile"    on athlete_profile;
drop policy if exists "edit profile"   on athlete_profile;
drop policy if exists "remove profile" on athlete_profile;

create policy "read profile" on athlete_profile for select to authenticated
  using (auth.uid() = user_id);
create policy "add profile" on athlete_profile for insert to authenticated
  with check (auth.uid() = user_id and not public.is_demo());
create policy "edit profile" on athlete_profile for update to authenticated
  using (auth.uid() = user_id and not public.is_demo())
  with check (auth.uid() = user_id and not public.is_demo());
create policy "remove profile" on athlete_profile for delete to authenticated
  using (auth.uid() = user_id and not public.is_demo());

-- ---------------------------------------------------------- athlete_sets
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
-- plans, routines, workout_logs and profiles come from the earlier app. The
-- same rule: the demo account reads them and changes nothing.
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

-- Check it, as the demo athlete's session:
--   select public.is_demo();                     -- true for them, false for everyone
--   update athlete_profile set updated_at = now(); -- 0 rows: nothing to update
--   insert into athlete_sets (user_id, day, exercise, sets)
--     values (auth.uid(), current_date, 'test', 1);  -- row-level security error
-- And as any other athlete, that insert still works.

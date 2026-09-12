-- Many athletes, one app.
--
-- 002 built these tables for a single athlete: one token row, one profile, a
-- log with no owner column. This gives every row an owner (user_id), moves the
-- existing athlete's data onto their account, and adds row-level security
-- policies so a signed-in user reaches their own rows and nobody else's.
--
-- Compatible with the code on either side of it: the old `id` columns stay (the
-- existing athlete's rows keep id = 'singleton'), new rows get a random id, and
-- user_id sits alongside. Safe to re-run.
--
-- Run in the Supabase SQL editor BEFORE deploying the code that uses it.

-- ---------------------------------------------------------------- ownership
alter table whoop_tokens    add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table athlete_profile add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table athlete_sets    add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table decision_log    add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- One row per athlete now, not one row in total.
alter table whoop_tokens    drop constraint if exists whoop_tokens_singleton;
alter table athlete_profile drop constraint if exists athlete_profile_singleton;
alter table whoop_tokens    alter column id set default gen_random_uuid()::text;
alter table athlete_profile alter column id set default gen_random_uuid()::text;

-- The existing athlete is the one named on the existing profile.
do $$
declare owner uuid;
begin
  select nullif(config->>'owner_user_id', '')::uuid into owner
    from athlete_profile where id = 'singleton';
  if owner is not null then
    update whoop_tokens    set user_id = owner where user_id is null;
    update athlete_profile set user_id = owner where user_id is null;
    update athlete_sets    set user_id = owner where user_id is null;
    update decision_log    set user_id = owner where user_id is null;
  end if;
end $$;

-- decision_log was keyed by day alone, and two athletes share days. The key
-- becomes (user_id, day), with a surrogate id as the primary key.
alter table decision_log add column if not exists id bigint generated always as identity;
do $$
begin
  if exists (select 1 from pg_constraint
             where conrelid = 'decision_log'::regclass and contype = 'p'
               and pg_get_constraintdef(oid) = 'PRIMARY KEY (day)') then
    alter table decision_log drop constraint decision_log_pkey;
    alter table decision_log add primary key (id);
  end if;
end $$;

create unique index if not exists whoop_tokens_user_idx    on whoop_tokens (user_id);
create unique index if not exists athlete_profile_user_idx on athlete_profile (user_id);
create unique index if not exists decision_log_user_day    on decision_log (user_id, day);
create index        if not exists athlete_sets_user_day    on athlete_sets (user_id, day);

-- ---------------------------------------------------------------- policies
-- whoop_tokens keeps NO policies: tokens are only ever read or written
-- server-side with the service role key, never with a user's session.
drop policy if exists "own profile" on athlete_profile;
create policy "own profile" on athlete_profile for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own sets" on athlete_sets;
create policy "own sets" on athlete_sets for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Decisions are written by the morning job alone; athletes can read theirs.
drop policy if exists "own decisions" on decision_log;
create policy "own decisions" on decision_log for select to authenticated
  using (auth.uid() = user_id);

-- Check it worked (every row should be owned):
--   select 'sets' as t, count(*) filter (where user_id is null) as unowned from athlete_sets
--   union all select 'profile', count(*) filter (where user_id is null) from athlete_profile
--   union all select 'tokens', count(*) filter (where user_id is null) from whoop_tokens
--   union all select 'decisions', count(*) filter (where user_id is null) from decision_log;

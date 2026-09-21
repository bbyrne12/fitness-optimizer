-- The demo coach's budget.
--
-- Every reviewer signs in as the same demo athlete, so a per-athlete cap is a
-- cap on all of them together: one heavy visitor would spend it and the coach
-- would be broken for everyone after. This gives the demo its own daily
-- budget, apart from real athletes, and splits it by visitor.
--
-- A visitor is an anonymous cookie (fo_visitor, a random id), or a hash of
-- their IP when no cookie arrives. Raw IPs are never stored. Each network
-- also has a ceiling, a few visitors' worth, for anyone who clears cookies
-- to start over.
--
-- Both tables have row-level security on and no policies: no signed-in
-- session can read or change them, the demo included. Only the app's
-- service role reaches them, through the two functions below.
--
-- Nothing to fill in. Safe to re-run.

create table if not exists demo_coach_usage (
  day       date not null,
  -- 'total' for the whole demo, 'v:<cookie id>', or 'ip:<hash>'
  bucket    text not null,
  messages  int  not null default 0,
  usd       numeric(10, 4) not null default 0,
  -- Set once, the first time the day's total crosses 80% of the budget.
  warned_at timestamptz,
  primary key (day, bucket)
);
alter table demo_coach_usage enable row level security;

-- Replies to the demo's suggested prompts, so the questions every reviewer
-- asks first are paid for once a day rather than once a visitor. Keyed on the
-- plan as well as the day: a visitor who has changed the plan gets a fresh
-- answer, not one about a plan they no longer have.
create table if not exists demo_coach_cache (
  day        date not null,
  prompt     text not null,
  plan_hash  text not null,
  reply      text not null,
  created_at timestamptz not null default now(),
  primary key (day, prompt, plan_hash)
);
alter table demo_coach_cache enable row level security;

-- Take one message, or say which limit stops it. Checks and counts in one
-- transaction, serialised per day, so two tabs cannot both take the last one.
-- Returns 'ok', 'budget', 'visitor' or 'network'.
create or replace function public.demo_coach_take(
  p_day date, p_visitor text, p_network text,
  p_visitor_max int, p_network_max int, p_budget numeric)
returns text language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('demo_coach:' || p_day::text));

  if coalesce((select usd from demo_coach_usage where day = p_day and bucket = 'total'), 0) >= p_budget
    then return 'budget'; end if;

  select messages into n from demo_coach_usage where day = p_day and bucket = p_visitor;
  if coalesce(n, 0) >= p_visitor_max then return 'visitor'; end if;

  if p_network is not null and p_network <> p_visitor then
    select messages into n from demo_coach_usage where day = p_day and bucket = p_network;
    if coalesce(n, 0) >= p_network_max then return 'network'; end if;
    insert into demo_coach_usage (day, bucket, messages) values (p_day, p_network, 1)
      on conflict (day, bucket) do update set messages = demo_coach_usage.messages + 1;
  end if;

  insert into demo_coach_usage (day, bucket, messages) values (p_day, p_visitor, 1)
    on conflict (day, bucket) do update set messages = demo_coach_usage.messages + 1;
  insert into demo_coach_usage (day, bucket, messages) values (p_day, 'total', 1)
    on conflict (day, bucket) do update set messages = demo_coach_usage.messages + 1;
  return 'ok';
end $$;

-- Add what a message actually cost. Returns true exactly once a day: on the
-- message that carries the total across 80% of the budget.
create or replace function public.demo_coach_spend(
  p_day date, p_visitor text, p_usd numeric, p_budget numeric)
returns boolean language plpgsql security definer set search_path = public as $$
declare after numeric;
begin
  insert into demo_coach_usage (day, bucket, usd) values (p_day, 'total', p_usd)
    on conflict (day, bucket) do update set usd = demo_coach_usage.usd + excluded.usd
    returning usd into after;
  update demo_coach_usage set usd = usd + p_usd where day = p_day and bucket = p_visitor;

  if after >= 0.8 * p_budget then
    update demo_coach_usage set warned_at = now()
      where day = p_day and bucket = 'total' and warned_at is null;
    return found;
  end if;
  return false;
end $$;

-- Service role only. Supabase grants new functions to anon and authenticated
-- by default, so that is revoked by name as well as from public.
revoke all on function public.demo_coach_take(date, text, text, int, int, numeric)
  from public, anon, authenticated;
revoke all on function public.demo_coach_spend(date, text, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.demo_coach_take(date, text, text, int, int, numeric) to service_role;
grant execute on function public.demo_coach_spend(date, text, numeric, numeric) to service_role;

-- What the demo spent, and whether anyone leaned on it:
--   select day, bucket, messages, usd, warned_at from demo_coach_usage
--   order by day desc, usd desc limit 30;
-- Days it crossed 80%:
--   select day, usd, warned_at from demo_coach_usage
--   where bucket = 'total' and warned_at is not null order by day desc;

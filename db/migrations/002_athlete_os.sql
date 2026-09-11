-- Athlete OS: WHOOP-driven morning decision.
--
-- This repo is public, so none of this data lives in git. Every table below
-- has RLS enabled with NO policies, which means the anon and publishable keys
-- cannot read it at all -- only the service role key, which lives in Vercel's
-- environment and never in the repo.

-- ---------------------------------------------------------------- tokens
-- Exactly one row. WHOOP rotates the refresh token on every use and kills the
-- old one instantly, so exactly one process may own the refresh. That process
-- is the Vercel route; the laptop scripts become read-only once this is live.
create table if not exists whoop_tokens (
  id            text primary key default 'singleton',
  access_token  text        not null,
  refresh_token text        not null,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now(),
  constraint whoop_tokens_singleton check (id = 'singleton')
);

-- ---------------------------------------------------------------- profile
-- Goals, race date, lacrosse days, tunables, VO2 max history.
create table if not exists athlete_profile (
  id         text primary key default 'singleton',
  config     jsonb       not null,
  updated_at timestamptz not null default now(),
  constraint athlete_profile_singleton check (id = 'singleton')
);

-- ---------------------------------------------------------------- lifting
-- The parsed Notes log. Re-pushed whenever the log is updated.
create table if not exists athlete_sets (
  id         bigserial primary key,
  day        date    not null,
  exercise   text    not null,
  weight     numeric,
  reps       integer,
  sets       integer not null default 1,
  pin        text,
  notes      text
);
create index if not exists athlete_sets_day_idx on athlete_sets (day);
create index if not exists athlete_sets_ex_idx  on athlete_sets (lower(exercise));

-- ---------------------------------------------------------------- history
-- One row per day. Doubles as the "already emailed today" guard, so a poll
-- running every 30 minutes can never send twice.
create table if not exists decision_log (
  day        date primary key,
  decision   jsonb not null,
  emailed_at timestamptz
);

alter table whoop_tokens   enable row level security;
alter table athlete_profile enable row level security;
alter table athlete_sets    enable row level security;
alter table decision_log    enable row level security;
-- No policies on purpose: service role only.

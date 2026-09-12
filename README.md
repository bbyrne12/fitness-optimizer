# Fitness Optimizer

A training app that reads WHOOP recovery data each morning and emails one
specific prescription for the day: what to train, how hard, and at what loads.

**Live:** https://fitness-optimizer.vercel.app
**Stack:** Next.js 16 (App Router, React 19 Server Components) · TypeScript ·
Supabase (Postgres + Auth + RLS) · Tailwind + shadcn/ui · Vercel · WHOOP API ·
Anthropic API

<p>
  <img src="docs/screenshots/morning-email.png" alt="The morning email: one decision for the day, adjusted for recovery" height="440">
  <img src="docs/screenshots/training-plan.png" alt="Training plan: weeks to the race, current block, unlock gates, this week's sessions" height="440">
  <img src="docs/screenshots/workout-journal.png" alt="Workout journal calendar with logged sessions" height="440">
</p>

## What it does

Two halves that share a database.

**The app.** Sign up, complete a three-step profile (goal, experience,
equipment), and get a generated weekly plan. `analyzeRoutine()` computes weekly
set volume per muscle (primary muscles count as a full set, secondary as half),
detects push/pull and upper/lower imbalances, and ranks them by severity. The
plan generator picks a split from available days and goal (for strength: 3 days
→ PPL, 4 → Upper/Lower ×2, 5 → PPL plus Upper/Lower; cardio and weight-loss
goals mix in conditioning days), filters the exercise library by owned
equipment, weights selection toward the muscles flagged as underworked, and
prescribes volume by experience level. Workouts are logged on a calendar, or
pasted in as free text and parsed.

**The morning decision.** Anyone can sign up and connect their own WHOOP account
through OAuth on the setup page. A scheduled job hits `/api/morning`, which, for
each connected athlete, pulls last night's WHOOP recovery, sleep and strain,
combines it with their training history, and emails a single decision: train or back off, which session, which exercises,
and what weight for each based on the last time that lift was performed. The
engine (`lib/athlete/decide.ts`) is a pure function. Records and config in, a
decision out, no fetching and no rendering, so it can be tested and read on its
own.

## Engineering notes

The parts of this that took real thought.

**The scheduler had to be moved, twice, for a measurable reason.** WHOOP scores
recovery a median of 13 minutes after wake, and wake time varies by hours, so a
fixed morning alarm is wrong most days. The job therefore polls a wide window
and sends only once recovery is actually scored, with the day's row in
`decision_log` doubling as the already-sent guard so repeated polls don't send
repeat emails. GitHub Actions was the first poller and turned out to fire 2 of
roughly 32 scheduled runs in its first 34 hours, because scheduled workflows on
free public repos are best-effort. The replacement is `pg_cron` inside
Postgres, a real scheduler, with the Actions workflow kept as a fallback until
the new job has proven itself. The reasoning is preserved in
`db/migrations/003_morning_cron.sql`.

**WHOOP rotates its refresh token on every use and invalidates the old one
immediately.** That makes concurrent refreshes a permanent lockout rather than a
retryable error, so only one code path may refresh, and it must persist the new
pair before using it. Each athlete has one token row, reachable only with the
service role key; the OAuth callback stores the first pair and after that only
the morning route refreshes it.

**Every athlete's data is fenced off from every other athlete's.** Each row in
the `athlete_*` tables carries its owner's user id, and row-level security
limits a signed-in user to their own rows. WHOOP tokens have no policy at all,
so only the service role key, which lives in Vercel's environment, can read
them.

**The tunables are calibrated against data, and say so when the data is thin.**
Each activity carries a recovery cost estimated from the athlete's own history.
Where the sample is small the comment records the sample size, the standard
error, and what would change the number. The tennis cost, for example, is
documented as the weakest-evidenced value in the set, derived from seven clean
sessions with a next-day residual of -1.8 ± 5.9, which is statistically
indistinguishable from zero, and set conservatively for a stated reason.

**Recommendations trace to a source.** `lib/athlete/protocols.ts` holds the
external research separately from the engine. Every protocol carries the
finding, the number it implies, the citation, the search that found it, a
confidence level, and the date it was last reviewed, so any advice the app gives
can be traced to something other than an opinion.

## Architecture

```
app/
  api/morning/route.ts   the daily decision endpoint (auth'd by CRON_SECRET)
  api/whoop/             WHOOP OAuth connect and callback
  athlete/               per-athlete setup: WHOOP connection and profile
  onboarding/            three-step profile wizard
  plan/ plans/           AI plan generation, plan list and detail
  log-workout/           calendar logging and free-text paste parsing
  exercises/             searchable exercise library
lib/
  muscle-analysis.ts     volume per muscle, imbalance detection
  plan-generator.ts      split selection and exercise prescription
  athlete/
    decide.ts            the decision engine (pure)
    protocols.ts         cited research, dated and confidence-rated
    whoop.ts             WHOOP v2 client with correct token rotation
    parse-log.ts         free-text workout log parser
db/migrations/           schema, applied via the Supabase SQL editor
```

Data mutations are Server Actions rather than route handlers. Route handlers
exist only where something outside the app needs a URL: the scheduler
(`/api/morning`), WHOOP's OAuth redirect (`/api/whoop/*`) and Supabase's
auth-confirm callback. Every user-facing table
uses RLS scoped to `auth.uid()`.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in the two Supabase values
npm run dev
```

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

The app runs on those two alone. The morning decision additionally needs
`SUPABASE_SERVICE_ROLE_KEY`, `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`,
`RESEND_API_KEY`, `EMAIL_FROM` and `CRON_SECRET`. Apply the files in
`db/migrations/` in order via the Supabase SQL editor. Register
`https://<your-domain>/api/whoop/callback` as a redirect URL on the WHOOP app
(or set `WHOOP_REDIRECT_URI`). `EMAIL_FROM` must be on a domain verified with
Resend: its test sender only delivers to the Resend account's own address.

Everything specific to an athlete lives in their `athlete_profile` row, set from
the setup page rather than the code: race date, sport days and times, zone 2
ceiling, email address, per-session cues, lifts to keep off
automatic progression (`manual_lifts`), replacement "add today" exercises
(`additions`), a measured cadence, and overrides for any tunable. The recovery
costs in `DEFAULT_TUNABLES` were calibrated on one athlete's WHOOP history and
are meant to be refit for anyone else.

`GET /api/morning?dry=1` runs the whole pipeline, sends nothing, and returns the
decision as JSON. That is the fastest way to see what the engine does.

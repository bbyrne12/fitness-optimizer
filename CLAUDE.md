# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Dev server on localhost:3000
npm run build     # Production build (also catches type errors)
npm run lint      # ESLint check
npx tsc --noEmit  # Type-check without building
```

## Architecture

**Next.js 15 App Router** with React 19 Server Components. Supabase handles auth and PostgreSQL via `@supabase/ssr` (cookie-based for SSR). All data mutations use `"use server"` Server Actions — there are no API route handlers for CRUD.

### Core Business Logic (lib/)

Two pure, dependency-free modules drive the app:

- **`lib/muscle-analysis.ts`** — `analyzeRoutine(routine[])` computes weekly volume per muscle (primary = full sets, secondary = 0.5×), detects push/pull and upper/lower imbalances, and returns severity-ranked recommendations. Used by the dashboard analysis card and as input to the plan generator.

- **`lib/plan-generator.ts`** — `generateWeeklyPlan(input)` selects a training split based on available days (3→PPL, 4→Upper/Lower×2, 5+→PPL+extras), filters the exercise library by equipment, prioritizes exercises targeting identified imbalance muscles, and prescribes volume by experience level (Beginner: 3×10, Intermediate: 4×10, Advanced: 5×8).

### Supabase Clients

Two separate clients must be used correctly:
- `lib/supabase/client.ts` — browser (singleton, uses `createBrowserClient`)
- `lib/supabase/server.ts` — server (new instance per request, uses `createServerClient` with cookies)

Auth middleware in `lib/supabase/middleware.ts` refreshes sessions and redirects unauthenticated users away from protected routes.

### Database Schema

| Table | Key Columns | Notes |
|---|---|---|
| `profiles` | `id`, `primary_goal`, `experience_level`, `available_equipment[]` | 1:1 with auth.users |
| `exercises` | `id`, `name`, `primary_muscle`, `secondary_muscles[]`, `equipment`, `difficulty` | Read-only library |
| `plans` | `id`, `user_id`, `name`, `source` ('manual'\|'generated'), `is_active` | `is_active` unique per user |
| `routines` | `id`, `user_id`, `exercise_id`, `plan_id`, `sets`, `reps`, `weight`, `day_of_week` | Exercises assigned to a plan |
| `workout_logs` | `id`, `user_id`, `exercise_id`, `sets`, `reps`, `weight`, `logged_at` | Completed sessions |

All tables use RLS — users can only access their own rows.

### Route Structure

Protected routes (require auth) live under `app/protected/` or are checked in middleware:
- `/protected` — dashboard with routine analysis
- `/onboarding` — 3-step profile wizard (goal → experience → equipment); auto-redirected if profile missing
- `/plans` and `/plans/[id]` — plan list and detail/edit
- `/plan` — AI plan generation UI (`plan-view.tsx` is a large client component)
- `/log-workout` — calendar-based workout logging
- `/exercises` — paginated exercise library with search/filter
- `/routine` — legacy manual routine editor (still functional)

### Styling

Dark-first design: `bg-zinc-950` background, `lime-400` primary accent, `border-zinc-800` / `bg-zinc-900` cards. Cardio days in plan view use orange accent. Components come from shadcn/ui (New York style) built on Radix UI primitives, all in `components/ui/`.

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

See `.env.example` for the template. `SUPABASE_SERVICE_ROLE_KEY` is optional (admin ops only).

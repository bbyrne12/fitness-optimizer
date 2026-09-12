/**
 * GET /api/morning
 *
 * A scheduler polls this through the morning. For every athlete with WHOOP
 * connected it sends at most one email a day, and only once WHOOP has actually
 * scored that athlete's recovery -- which lands shortly after waking, and
 * waking time varies by hours from day to day. A fixed alarm would be hours
 * late most mornings.
 *
 * ?dry=1        run everything, send nothing, return the decisions
 * ?force=1      send even if today has already been emailed
 * ?user=<uuid>  run for one athlete only
 */
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { admin } from "@/lib/athlete/supabase";
import { accessToken, body, pull } from "@/lib/athlete/whoop";
import { renderEmail, sendEmail } from "@/lib/athlete/email";
import {
  buildState, racePlan, weekTemplate, decide, prescribe,
  imbalances, loadWarnings, intensityDistribution, protocolFlags,
  runConsistencyWeeks, readiness, mesocycle, personalFrom, planInputs,
  whoopSportSummary, activityCosts,
  DEFAULT_TUNABLES, type LoggedSet, type Tunables,
} from "@/lib/athlete/decide";
import { PROTOCOLS } from "@/lib/athlete/protocols";

// No `dynamic = "force-dynamic"`: this project has cacheComponents on, which
// rejects it, and reading the Authorization header already makes the route
// dynamic.
export const maxDuration = 60;

// A WHOOP pull takes a few seconds. A handful of athletes at a time keeps the
// run inside the time limit without sending WHOOP every request at once.
const CONCURRENCY = 4;
const PAGE = 1000;

type RunOpts = { dry: boolean; force: boolean; origin: string };

export async function GET(req: NextRequest) {
  // The GitHub Actions poller and pg_cron both send this secret. Without it the
  // route is public, and every call spends each athlete's WHOOP quota.
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const force = url.searchParams.get("force") === "1";
  const only = url.searchParams.get("user");

  try {
    // Inside the try on purpose: admin() throws when the service role key is
    // missing, and outside it that surfaces as a bare 500 with no body.
    const db = admin();

    const missing = ["SUPABASE_SERVICE_ROLE_KEY", "WHOOP_CLIENT_ID",
                     "WHOOP_CLIENT_SECRET", "RESEND_API_KEY"]
      .filter((k) => !process.env[k]);
    if (missing.length && !dry) {
      return NextResponse.json(
        { error: `missing environment variables: ${missing.join(", ")}` },
        { status: 500 });
    }

    // Everyone who has connected WHOOP. Their profile decides whether there is
    // enough to build a plan from.
    let query = db.from("whoop_tokens").select("user_id").not("user_id", "is", null);
    if (only) query = query.eq("user_id", only);
    const { data: connections, error } = await query;
    if (error) throw new Error(`could not list WHOOP connections: ${error.message}`);
    const ids: string[] = (connections ?? []).map((c: { user_id: string }) => c.user_id);

    // One athlete's failure -- a revoked WHOOP grant, a rejected email -- must
    // not cost anyone else their morning, so each one is caught on its own.
    const results = await inBatches(ids, CONCURRENCY, (id) =>
      runForAthlete(db, id, { dry, force, origin: url.origin }).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[morning]", id, msg);
        return { user_id: id, sent: false, error: msg };
      }));

    return NextResponse.json({ athletes: ids.length, env_missing: missing, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[morning]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function inBatches<T, R>(xs: T[], size: number, fn: (x: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += size)
    out.push(...(await Promise.all(xs.slice(i, i + size).map(fn))));
  return out;
}

/** PostgREST caps a response at 1000 rows, and a long training log passes that. */
async function allRows(page: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** WHOOP's "-04:00" as minutes east of UTC (-240). */
function offsetMinutes(offset: unknown): number | null {
  if (typeof offset !== "string") return null;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
}

const dayAt = (offsetMin: number) =>
  new Date(Date.now() + offsetMin * 60_000).toISOString().slice(0, 10);

async function alreadyEmailed(db: SupabaseClient, userId: string, day: string) {
  const { data } = await db.from("decision_log").select("emailed_at")
    .eq("user_id", userId).eq("day", day).maybeSingle();
  return Boolean(data?.emailed_at);
}

async function runForAthlete(db: SupabaseClient, userId: string, opts: RunOpts) {
  const { data: prof } = await db.from("athlete_profile").select("config")
    .eq("user_id", userId).maybeSingle();
  const cfg = (prof?.config ?? null) as Record<string, any> | null;
  if (!cfg)
    return { user_id: userId, sent: false, skipped: "no training profile yet" };

  // Cheap check first: an athlete already emailed today costs no WHOOP call.
  const lastKnownToday = dayAt(cfg.utc_offset_minutes ?? 0);
  if (!opts.force && !opts.dry && await alreadyEmailed(db, userId, lastKnownToday))
    return { user_id: userId, sent: false, reason: "already emailed", day: lastKnownToday };

  // Two sources, because there are two ways to log: pasted text in
  // athlete_sets, and the app's own calendar logger writing workout_logs.
  const [setRows, appRows] = await Promise.all([
    allRows((a, b) => db.from("athlete_sets").select("day,exercise,weight,reps,sets,pin")
      .eq("user_id", userId).order("id").range(a, b)),
    allRows((a, b) => db.from("workout_logs")
      .select("sets,reps,weight,logged_at,exercises(name,primary_muscle,secondary_muscles)")
      .eq("user_id", userId).order("id").range(a, b)),
  ]);

  const tun: Tunables = { ...DEFAULT_TUNABLES, ...(cfg.tunables ?? {}) };
  // Names typed by hand carry no muscle data of their own, so the alias map
  // resolved at save time supplies it here.
  const aliases = (cfg.exercise_aliases ?? {}) as Record<string, any>;
  const alias = (name: string) =>
    aliases[name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()];

  const fromNotes = setRows.map((r): LoggedSet => {
    const a = alias(r.exercise);
    return {
      day: r.day, exercise: r.exercise, weight: r.weight,
      reps: r.reps, sets: r.sets, pin: r.pin,
      primary_muscle: a?.primary_muscle || null,
      secondary_muscles: a?.secondary_muscles ?? null,
    };
  });

  const fromApp = appRows.flatMap((r: any): LoggedSet[] => {
    const ex = Array.isArray(r.exercises) ? r.exercises[0] : r.exercises;
    if (!ex?.name || !r.logged_at) return [];
    return [{
      day: String(r.logged_at).slice(0, 10),
      exercise: ex.name,
      weight: r.weight ?? null,
      reps: r.reps ?? null,
      sets: r.sets ?? 1,
      pin: null,
      primary_muscle: ex.primary_muscle ?? null,
      secondary_muscles: ex.secondary_muscles ?? null,
    }];
  });

  // Where both sources describe the same lift on the same day, the app entry
  // wins: it is the deliberate, structured one.
  const appKeys = new Set(
    fromApp.map((r) => `${r.day}|${r.exercise.trim().toLowerCase()}`));
  const sets: LoggedSet[] = [
    ...fromNotes.filter(
      (r) => !appKeys.has(`${r.day}|${r.exercise.trim().toLowerCase()}`)),
    ...fromApp,
  ];

  const at = await accessToken(userId);
  const w = await pull(at);
  if (!(w.recovery as any[]).some((r) => r.score))
    return { user_id: userId, sent: false, waiting: true, reason: "no scored recovery on WHOOP yet" };
  const state = buildState(w);

  // Local time comes from the athlete's own WHOOP records, so travel and
  // daylight saving follow them. The profile keeps the last value seen, which
  // the paste box uses to decide what "today" means.
  const latestSleep = [...(w.sleep as any[])]
    .sort((a, b) => String(b.start).localeCompare(String(a.start)))[0];
  const offset = offsetMinutes(latestSleep?.timezone_offset) ?? cfg.utc_offset_minutes ?? 0;
  // What each sport costs this athlete, measured from their own history. Kept
  // on the profile, at most once a day, so the setup page and calendar can
  // show it without calling WHOOP themselves.
  const sports = whoopSportSummary(w);
  if (offset !== cfg.utc_offset_minutes || cfg.whoop_summary?.updated !== state.date) {
    const measured = cfg.whoop_summary?.max_heart_rate ? null : await body(at).catch(() => null);
    await db.from("athlete_profile").update({ config: {
      ...cfg,
      utc_offset_minutes: offset,
      whoop_summary: {
        ...(cfg.whoop_summary ?? {}),
        updated: state.date,
        sports,
        resting_heart_rate: state.rhr ?? null,
        ...(measured?.max_heart_rate ? { max_heart_rate: measured.max_heart_rate } : {}),
      },
    } }).eq("user_id", userId);
  }

  // Has today's recovery actually landed? If not, say so and wait.
  const todayLocal = dayAt(offset);
  if (state.date !== todayLocal)
    return { user_id: userId, sent: false, waiting: true, latest: state.date, expecting: todayLocal };

  if (!opts.force && !opts.dry && todayLocal !== lastKnownToday
      && await alreadyEmailed(db, userId, todayLocal))
    return { user_id: userId, sent: false, reason: "already emailed", day: todayLocal };

  // Longest run in the last three weeks: the anchor for the whole ladder.
  // Three weeks rather than sixty days so a good run two months ago stops
  // propping up a plan that is no longer being trained for.
  let recentLong = 2.5;
  for (const [day, xs] of Object.entries(state._workouts)) {
    if (day <= new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10)) continue;
    for (const x of xs as any[])
      if (x.sport_name === "running" && x.score?.distance_meter)
        recentLong = Math.max(recentLong, x.score.distance_meter / 1609.34);
  }

  const inputs = planInputs(cfg);
  const plan = racePlan(inputs.race, state.date, recentLong, inputs.longestRunMi);
  const personal = personalFrom(cfg);
  personal.activityCosts = activityCosts(inputs.activities, sports, tun);
  const template = weekTemplate(inputs);
  const z2 = inputs.zone2;
  const decision = decide(state, plan, template, tun, z2, personal);
  // Readiness is measured, not scheduled: consecutive weeks with at least
  // two runs. Adding a run type before the criteria are met is the fastest
  // way to get hurt, and the calendar cannot tell whether the work happened.
  const consistency = runConsistencyWeeks(state._workouts as any, state.date,
                                          Math.min(2, Math.max(1, inputs.runDays)));
  const ready = readiness(consistency);
  const session = prescribe(sets, decision.planned, decision.level, z2,
                            plan.long_run_this_week_mi,
                            { hrvStreak: state.hrv_low_streak,
                              intervalsReady: ready.intervals,
                              easyMinutes: plan.easy_run_minutes, personal });
  const dist = intensityDistribution(state._workouts as any, state.date);
  // Phase follows weeks actually trained, not weeks elapsed.
  const meso = mesocycle(consistency, inputs.race ? plan.weeks_out : Infinity);
  const { per_week, flags } = imbalances(sets, state.date);
  const warns = loadWarnings(sets, state.date, tun);

  const payload = {
    state: { ...state, _workouts: undefined },
    decision, session, plan, week: template,
    volume_per_week: per_week,
    imbalances: [...flags, ...protocolFlags(dist, { template, cadenceSpm: personal.cadenceSpm })],
    load_warnings: warns, intensity: dist,
    sources: { notes: fromNotes.length, app: fromApp.length, used: sets.length },
    readiness: ready, meso,
    protocols: PROTOCOLS.map(({ id, title, source, confidence, reviewed }) =>
      ({ id, title, source, confidence, reviewed })),
    tunables: tun,
    activity_costs: personal.activityCosts,
  };

  if (opts.dry) return { user_id: userId, sent: false, dry: true, ...payload };

  const to = cfg.email_to || (await db.auth.admin.getUserById(userId)).data.user?.email;
  if (!to) return { user_id: userId, sent: false, skipped: "no email address" };

  const html = renderEmail({
    date: state.date, dow: state.dow, recovery: state.recovery,
    decision, session,
    dashboardUrl: cfg.dashboard_url ?? `${opts.origin}/calendar`,
    phase: { phase: meso.phase, job: meso.job, recovery_week: meso.recovery_week },
  });
  const { id } = await sendEmail(
    to, `${decision.call}  (${Math.round(state.recovery)}% recovered)`, html);

  // The email has gone. If this write fails the next poll sends it again, so
  // the failure is reported rather than swallowed.
  const { error: logErr } = await db.from("decision_log").upsert(
    { user_id: userId, day: state.date, decision: payload, emailed_at: new Date().toISOString() },
    { onConflict: "user_id,day" });

  return {
    user_id: userId, sent: true, id, day: state.date, call: decision.call,
    ...(logErr ? { warning: `emailed but not logged: ${logErr.message}` } : {}),
  };
}

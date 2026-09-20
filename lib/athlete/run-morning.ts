/**
 * One athlete's morning: pull WHOOP, decide the day, store it, and email it.
 *
 * It lives here rather than in the route because two things need it -- the
 * scheduler that polls every morning, and the athlete asking the app to look
 * again because WHOOP scored them before they had finished sleeping.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { retrying } from "@/lib/athlete/supabase";
import { accessToken, body, pull, pullHistory } from "@/lib/athlete/whoop";
import { renderEmail, sendEmail } from "@/lib/athlete/email";
import {
  buildState, racePlan, weekTemplate, decide, prescribe,
  imbalances, loadWarnings, intensityDistribution, protocolFlags,
  runConsistencyWeeks, readiness, mesocycle, personalFrom, planInputs,
  whoopSportDays, mergeSportDays, summarizeSportDays, activityCosts, prematureMorning,
  dayKinds, learnRows, fitCosts, recoveryBands,
  DEFAULT_TUNABLES, type LoggedSet, type Tunables,
} from "@/lib/athlete/decide";
import { PROTOCOLS } from "@/lib/athlete/protocols";

export type RunOpts = { dry: boolean; force: boolean; origin: string };

/** PostgREST caps a response at 1000 rows, and a long training log passes that. */
const PAGE = 1000;

type Page = PromiseLike<{ data: any[] | null; error: { message: string } | null }>;
async function allRows(page: (from: number, to: number) => Page): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await retrying(() => page(from, from + PAGE - 1));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** The athlete's own "nothing before this" time, as minutes past local
 *  midnight. Unset means the only thing holding a decision is the night. */
function notBefore(cfg: Record<string, any>): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(cfg.morning_not_before ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** WHOOP's "-04:00" as minutes east of UTC (-240). */
function offsetMinutes(offset: unknown): number | null {
  if (typeof offset !== "string") return null;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
}

const dayAt = (offsetMin: number) =>
  new Date(Date.now() + offsetMin * 60_000).toISOString().slice(0, 10);

async function alreadyDecided(db: SupabaseClient, userId: string, day: string) {
  const { data, error } = await retrying(() => db.from("decision_log").select("day")
    .eq("user_id", userId).eq("day", day).maybeSingle());
  // Reading a failure as "not decided yet" would send the same email twice.
  if (error) throw new Error(`could not check today's decision: ${error.message}`);
  return Boolean(data);
}

export async function runMorning(db: SupabaseClient, userId: string, opts: RunOpts) {
  const { data: prof, error: profErr } = await retrying(() => db.from("athlete_profile")
    .select("config").eq("user_id", userId).maybeSingle());
  // A failed read is not "no profile": skipping on it would drop the athlete's
  // email without a trace, where throwing records the failure against them.
  if (profErr) throw new Error(`could not read profile: ${profErr.message}`);
  const cfg = (prof?.config ?? null) as Record<string, any> | null;
  if (!cfg)
    return { user_id: userId, sent: false, skipped: "no training profile yet" };

  // Cheap check first: an athlete already decided today costs no WHOOP call.
  const lastKnownToday = dayAt(cfg.utc_offset_minutes ?? 0);
  if (!opts.force && !opts.dry && await alreadyDecided(db, userId, lastKnownToday))
    return { user_id: userId, sent: false, reason: "already decided", day: lastKnownToday };

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
  // What each sport costs this athlete, measured from their own history. This
  // pull only reaches back a few months, so recent days are added to what is
  // already measured rather than replacing it -- otherwise a sport played in
  // spring would drop out of its own cost by autumn. Kept on the profile, at
  // most once a day, so the setup page and calendar never call WHOOP.
  const sportDays = mergeSportDays(cfg.whoop_summary?.sport_days ?? {}, whoopSportDays(w));
  const sports = summarizeSportDays(sportDays);
  // The same measurement for every kind of day the plan can schedule -- lifts
  // from the log, runs and sports from WHOOP, rest -- accumulated across the
  // whole history so the engine keeps learning what each one costs this
  // athlete. This is what the decision reads its costs from.
  // The first time, read the whole WHOOP history (about two years) so the
  // learning starts from everything, not the last four months; after that
  // the daily pull adds each new morning.
  const hist = cfg.learned?.days ? w : await pullHistory(at).catch(() => w);
  const early = planInputs(cfg);
  const learnedRows = { ...(cfg.learned?.days ?? {}), ...learnRows(hist, dayKinds(hist, sets, early.zone2)) };
  const sessionCosts = fitCosts(learnedRows, tun, early.activities);
  if (offset !== cfg.utc_offset_minutes || cfg.whoop_summary?.updated !== state.date) {
    const measured = cfg.whoop_summary?.max_heart_rate ? null : await body(at).catch(() => null);
    await retrying(() => db.from("athlete_profile").update({ config: {
      ...cfg,
      utc_offset_minutes: offset,
      whoop_summary: {
        ...(cfg.whoop_summary ?? {}),
        updated: state.date,
        sport_days: sportDays,
        sports,
        resting_heart_rate: state.rhr ?? null,
        ...(measured?.max_heart_rate ? { max_heart_rate: measured.max_heart_rate } : {}),
      },
      learned: { updated: state.date, days: learnedRows, costs: sessionCosts },
    } }).eq("user_id", userId));
  }

  // Has today's recovery actually landed? If not, say so and wait.
  const todayLocal = dayAt(offset);
  if (state.date !== todayLocal)
    return { user_id: userId, sent: false, waiting: true, latest: state.date, expecting: todayLocal };

  // A short night is often a wake-up before going back to sleep; WHOOP scores
  // recovery at the first wake. Hold it until the night looks whole, or until
  // the cutoff. An athlete who has set their own earliest time is held to that
  // too.
  const morning = prematureMorning(w, Date.now(), notBefore(cfg));
  if (morning?.wait && !opts.force)
    return { user_id: userId, sent: false, waiting: true, reason: morning.reason };

  if (!opts.force && !opts.dry && todayLocal !== lastKnownToday
      && await alreadyDecided(db, userId, todayLocal))
    return { user_id: userId, sent: false, reason: "already decided", day: todayLocal };

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
  personal.sessionCosts = sessionCosts;
  // Green and red are this athlete's own, off their whole history, unless the
  // profile pins them by hand.
  personal.bands = recoveryBands(hist, tun, learnedRows,
    Boolean(cfg.tunables && ("recovery_green" in cfg.tunables || "recovery_red" in cfg.tunables)));
  // One set of numbers: an activity's cost is its learned one where that has
  // enough mornings behind it, unless the profile pins it.
  for (const a of inputs.activities) {
    const learned = sessionCosts[`sport:${a.sport}`];
    if (learned && learned.source === "measured" && personal.activityCosts[a.sport]?.source !== "profile")
      personal.activityCosts[a.sport] = learned;
  }
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
                              easyMinutes: plan.easy_run_minutes, personal,
                              defaultSets: tun.default_sets,
                              scale: decision.scale,
                              muscleOf: (n) => alias(n)?.primary_muscle,
                              today: state.date });
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
    session_costs: sessionCosts,
  };

  if (opts.dry) return { user_id: userId, sent: false, dry: true, ...payload };

  // An athlete who reads the decision in the app gets it stored and no email.
  // The stored row is what the dashboard shows, and the once-a-day guard.
  if (cfg.email_daily === false) {
    const { error: logErr } = await retrying(() => db.from("decision_log").upsert(
      { user_id: userId, day: state.date, decision: payload, emailed_at: null },
      { onConflict: "user_id,day" }));
    if (logErr) throw new Error(`could not store today's decision: ${logErr.message}`);
    return { user_id: userId, sent: false, decided: true, day: state.date, call: decision.call };
  }

  const to = cfg.email_to
    || (await retrying(() => db.auth.admin.getUserById(userId))).data.user?.email;
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
  const { error: logErr } = await retrying(() => db.from("decision_log").upsert(
    { user_id: userId, day: state.date, decision: payload, emailed_at: new Date().toISOString() },
    { onConflict: "user_id,day" }));

  return {
    user_id: userId, sent: true, id, day: state.date, call: decision.call,
    ...(logErr ? { warning: `emailed but not logged: ${logErr.message}` } : {}),
  };
}

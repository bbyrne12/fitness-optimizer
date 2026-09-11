/**
 * GET /api/morning
 *
 * The poller hits this every 30 minutes between 5am and 11am. It sends at most
 * one email a day, and only once WHOOP has actually scored today's recovery --
 * which lands a median of 13 minutes after he wakes, and his wake time swings
 * 5:15 to 9:43. A fixed alarm would be hours late most mornings.
 *
 * ?dry=1   run everything, send nothing, return the decision
 * ?force=1 send even if today has already been emailed
 */
import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/athlete/supabase";
import { accessToken, pull } from "@/lib/athlete/whoop";
import { renderEmail, sendEmail } from "@/lib/athlete/email";
import {
  buildState, racePlan, weekTemplate, decide, prescribe,
  imbalances, loadWarnings, intensityDistribution, protocolFlags,
  runConsistencyWeeks, readiness, mesocycle,
  DEFAULT_TUNABLES, type LoggedSet, type Tunables,
} from "@/lib/athlete/decide";
import { PROTOCOLS } from "@/lib/athlete/protocols";

// No `dynamic = "force-dynamic"`: this project has cacheComponents on, which
// rejects it, and reading the Authorization header already makes the route
// dynamic.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Vercel Cron sends a bearer token; the GitHub Actions poller sends the same
  // secret. Without it this route is public, and it spends API quota.
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const force = url.searchParams.get("force") === "1";

  try {
    // Inside the try on purpose: admin() throws when the service role key is
    // missing, and outside it that surfaces as a bare 500 with no body.
    const db = admin();

    // Fail loudly and by name, rather than somewhere deep in a fetch.
    const missing = ["SUPABASE_SERVICE_ROLE_KEY", "WHOOP_CLIENT_ID",
                     "WHOOP_CLIENT_SECRET", "RESEND_API_KEY", "EMAIL_TO"]
      .filter((k) => !process.env[k]);
    if (missing.length && !dry) {
      return NextResponse.json(
        { error: `missing environment variables: ${missing.join(", ")}` },
        { status: 500 });
    }

    const [{ data: prof }, { data: setRows }] = await Promise.all([
      db.from("athlete_profile").select("config").eq("id", "singleton").single(),
      db.from("athlete_sets").select("day,exercise,weight,reps,sets,pin"),
    ]);
    if (!prof) throw new Error("athlete_profile is empty -- push the config first");

    const cfg = prof.config as Record<string, any>;
    const tun: Tunables = { ...DEFAULT_TUNABLES, ...(cfg.tunables ?? {}) };
    const sets = (setRows ?? []).map((r): LoggedSet => ({
      day: r.day, exercise: r.exercise, weight: r.weight,
      reps: r.reps, sets: r.sets, pin: r.pin,
    }));

    const w = await pull(await accessToken());
    const state = buildState(w);

    // Has today's recovery actually landed? If not, say so and wait.
    const todayLocal = new Date(
      Date.now() + (cfg.utc_offset_minutes ?? -240) * 60_000,
    ).toISOString().slice(0, 10);
    if (state.date !== todayLocal) {
      return NextResponse.json({
        sent: false, waiting: true, latest: state.date, expecting: todayLocal,
      });
    }

    if (!force && !dry) {
      const { data: already } = await db
        .from("decision_log").select("emailed_at").eq("day", state.date).single();
      if (already?.emailed_at)
        return NextResponse.json({ sent: false, reason: "already emailed", day: state.date });
    }

    // Longest recent run, to anchor the build.
    let recentLong = 2.5;
    for (const [day, xs] of Object.entries(state._workouts)) {
      if (day <= new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)) continue;
      for (const x of xs as any[])
        if (x.sport_name === "running" && x.score?.distance_meter)
          recentLong = Math.max(recentLong, x.score.distance_meter / 1609.34);
    }

    const plan = racePlan(cfg.race.date, state.date, recentLong,
                          cfg.race.longest_run_ever_mi);
    const template = weekTemplate(cfg.lacrosse.days);
    const z2 = cfg.athlete.zone2_ceiling_bpm;
    const decision = decide(state, plan, template, tun, z2);
    // Readiness is measured, not scheduled: consecutive weeks with at least
    // two runs. Adding a run type before the criteria are met is the fastest
    // way to get hurt, and the calendar cannot tell whether the work happened.
    const consistency = runConsistencyWeeks(state._workouts as any, state.date);
    const ready = readiness(consistency);
    const session = prescribe(sets, decision.planned, decision.level, z2,
                              plan.long_run_this_week_mi,
                              { hrvStreak: state.hrv_low_streak,
                                intervalsReady: ready.intervals,
                                easyMinutes: plan.easy_run_minutes });
    const dist = intensityDistribution(state._workouts as any, state.date);
    const meso = mesocycle(plan.week_index, plan.weeks_out);
    const { per_week, flags } = imbalances(sets, state.date);
    const warns = loadWarnings(sets, state.date, tun);

    const payload = {
      state: { ...state, _workouts: undefined },
      decision, session, plan, week: template,
      volume_per_week: per_week,
      imbalances: [...flags, ...protocolFlags(dist)],
      load_warnings: warns, intensity: dist, readiness: ready, meso,
      protocols: PROTOCOLS.map(({ id, title, source, confidence, reviewed }) =>
        ({ id, title, source, confidence, reviewed })),
      tunables: tun,
    };

    if (dry)
      return NextResponse.json({ sent: false, dry: true, env_missing: missing, ...payload });

    const html = renderEmail({
      date: state.date, dow: state.dow, recovery: state.recovery,
      decision, session,
      dashboardUrl: cfg.dashboard_url ?? "",
      phase: { phase: meso.phase, job: meso.job, recovery_week: meso.recovery_week },
    });
    const { id } = await sendEmail(
      `${decision.call}  (${Math.round(state.recovery)}% recovered)`, html);

    await db.from("decision_log").upsert({
      day: state.date, decision: payload, emailed_at: new Date().toISOString(),
    });

    return NextResponse.json({ sent: true, id, day: state.date, call: decision.call });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[morning]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

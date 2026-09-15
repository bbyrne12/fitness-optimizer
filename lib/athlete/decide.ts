/**
 * The decision engine, ported from whoop-dashboard/decide.py.
 *
 * Pure: WHOOP records + logged sets + config in, a decision out. No fetching,
 * no rendering, no database. Kept deliberately small so the Python version and
 * this one can be read side by side and seen to agree.
 */
import { musclesFor, bucket, LOWER } from "./muscles";
import { INTENSITY_TARGET, CADENCE_TARGET } from "./protocols";

export const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type Tunables = {
  recovery_green: number;
  recovery_red: number;
  cost_running: number;
  cost_legs_quad: number;
  cost_lift_upper: number;
  sleep_debt_downgrade: number;
  hrv_low_streak_downgrade: number;
  max_weekly_mileage_growth: number;
  max_load_jump: number;
  default_sets: number;
};

export const DEFAULT_TUNABLES: Tunables = {
  recovery_green: 67,
  recovery_red: 34,
  cost_running: -11.0,
  // Sports are not listed: each one's cost is measured per athlete from their
  // own WHOOP history (whoopSportSummary), and `cost_<sport>` in a profile's
  // tunables overrides that.
  cost_legs_quad: -3.5,
  cost_lift_upper: -0.6,
  sleep_debt_downgrade: 2.0,
  hrv_low_streak_downgrade: 3,
  max_weekly_mileage_growth: 0.1,
  max_load_jump: 0.1,
  default_sets: 3,
};

export type Goal = "hrv" | "race" | "strength" | "general";
export type Distance = "5k" | "10k" | "half" | "marathon";
export type Intensity = "easy" | "moderate" | "hard";

/** What each race builds to: the peak long run before the taper, then the race. */
export const RACE_DISTANCES: Record<Distance, { label: string; miles: number; peakLongMi: number }> = {
  "5k": { label: "5K", miles: 3.1, peakLongMi: 6 },
  "10k": { label: "10K", miles: 6.2, peakLongMi: 9 },
  half: { label: "Half marathon", miles: 13.1, peakLongMi: 11 },
  marathon: { label: "Marathon", miles: 26.2, peakLongMi: 20 },
};

/** Something the athlete does on set days: a sport, a practice, a class. */
export type Activity = {
  /** WHOOP's sport_name where it has one, so the cost can be measured. */
  sport: string;
  label: string;
  days: string[];
  time: string | null;
  intensity: Intensity;
};

/** Everything the shape of the plan comes from, read off the profile. */
export type PlanInputs = {
  goals: Goal[];
  race: { distance: Distance; date: string; name: string; miles: number; peakLongMi: number } | null;
  liftDays: number;
  runDays: number;
  longRunDay: "Sat" | "Sun";
  activities: Activity[];
  zone2: number;
  longestRunMi: number;
};

const GOALS: Goal[] = ["hrv", "race", "strength", "general"];
const INTENSITIES: Intensity[] = ["easy", "moderate", "hard"];

/** Goals were a single `primary` before they could be combined. */
function readGoals(cfg: Record<string, any>, hasRace: boolean): Goal[] {
  const list: unknown = Array.isArray(cfg.goals?.list) ? cfg.goals.list : [cfg.goals?.primary];
  const goals = (list as unknown[]).filter((g): g is Goal => GOALS.includes(g as Goal));
  return goals.length ? goals : [hasRace ? "race" : "general"];
}

const dayCount = (n: unknown, fallback: number) => {
  const x = Math.round(Number(n));
  return n === undefined || n === null || !Number.isFinite(x) ? fallback : Math.min(5, Math.max(0, x));
};

/**
 * Reads a profile into plan inputs. Profiles saved before goals and activities
 * existed -- a bare race plus lacrosse and tennis keys -- are read the way the
 * engine always read them, so they keep producing the same week until the
 * setup form is saved.
 */
export function planInputs(cfg: Record<string, any>): PlanInputs {
  const r = cfg.goals
    ? cfg.goals.race
    : cfg.race?.date ? { distance: "half", date: cfg.race.date, name: cfg.race.name } : null;
  const distance: Distance = r && RACE_DISTANCES[r.distance as Distance] ? r.distance : "half";
  const race = r?.date && !Number.isNaN(Date.parse(r.date))
    ? {
        distance,
        date: String(r.date),
        name: String(r.name || RACE_DISTANCES[distance].label),
        miles: RACE_DISTANCES[distance].miles,
        peakLongMi: RACE_DISTANCES[distance].peakLongMi,
      }
    : null;

  const activities: Activity[] = Array.isArray(cfg.activities)
    ? cfg.activities.flatMap((a: any): Activity[] => {
        const days = (Array.isArray(a?.days) ? a.days : [])
          .map(String).filter((d: string) => (DOW as readonly string[]).includes(d));
        const sport = String(a?.sport ?? "").trim().toLowerCase();
        if (!sport || !days.length) return [];
        return [{
          sport,
          label: String(a.label || sport),
          days,
          time: typeof a.time === "string" && a.time ? a.time : null,
          intensity: INTENSITIES.includes(a.intensity) ? a.intensity : "moderate",
        }];
      })
    : [
        // The two fixtures the engine knew before activities existed.
        ...(cfg.lacrosse?.days?.length
          ? [{ sport: "lacrosse", label: "Lacrosse", days: cfg.lacrosse.days,
               time: cfg.lacrosse.time ?? null, intensity: "hard" as const }]
          : []),
        ...(cfg.tennis?.days?.length
          ? [{ sport: "tennis", label: "Tennis", days: cfg.tennis.days,
               time: null, intensity: "moderate" as const }]
          : []),
      ];

  const week = cfg.week ?? {};
  return {
    goals: readGoals(cfg, Boolean(race)),
    race,
    liftDays: dayCount(week.lift_days, 3),
    runDays: dayCount(week.run_days, 2),
    longRunDay: week.long_run_day === "Sun" ? "Sun" : "Sat",
    activities,
    zone2: Number(cfg.athlete?.zone2_ceiling_bpm) || 145,
    longestRunMi: Number(cfg.athlete?.longest_run_mi ?? cfg.race?.longest_run_ever_mi) || 0,
  };
}

export type ActivityCost = {
  value: number;
  n: number;
  source: "measured" | "profile" | "default";
};

/**
 * Everything specific to one athlete that the engine needs to word or shape a
 * day: session cues, lifts to leave off auto-progression, replacement "add
 * today" exercises, a measured cadence, their goal and activities. It lives in
 * athlete_profile.config -- data, not code -- so the code stays neutral and a
 * different athlete only needs a different profile.
 */
export type Personal = {
  cues: Record<string, string>;
  manualLifts: string[];
  additions: Record<string, [string, string, string]>;
  cadenceSpm: number | null;
  goals: Goal[];
  /** Muscle groups the athlete wants to bring up; steers the "add today" pick. */
  focusMuscles: string[];
  activities: Activity[];
  /** What each activity costs this athlete; filled in with activityCosts(). */
  activityCosts: Record<string, ActivityCost>;
  /** What every kind of training day costs this athlete, learned from their
   *  own mornings; filled in with learnedCosts(). Keys are session kinds:
   *  "lift:legs", "run:easy", "sport:lacrosse", "rest", "lift:pull+run:easy". */
  sessionCosts: Record<string, ActivityCost>;
};

/** "18:00" -> "6pm", "18:30" -> "6:30pm". Anything unparseable passes through. */
export function clock(t: unknown): string | null {
  if (typeof t !== "string" || !t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return t;
  const h = Number(m[1]), min = m[2];
  return `${h % 12 || 12}${min === "00" ? "" : ":" + min}${h < 12 ? "am" : "pm"}`;
}

export function personalFrom(cfg: Record<string, any>): Personal {
  const additions: Record<string, [string, string, string]> = {};
  for (const [kind, a] of Object.entries(cfg.additions ?? {}))
    if (Array.isArray(a) && a.length === 3) additions[kind] = a as [string, string, string];
  const inputs = planInputs(cfg);
  return {
    cues: { ...(cfg.cues ?? {}) },
    manualLifts: Array.isArray(cfg.manual_lifts) ? cfg.manual_lifts : [],
    additions,
    cadenceSpm: typeof cfg.cadence_spm === "number" ? cfg.cadence_spm : null,
    goals: inputs.goals,
    focusMuscles: Array.isArray(cfg.focus_muscles) ? cfg.focus_muscles.map(String) : [],
    activities: inputs.activities,
    activityCosts: {},
    sessionCosts: {},
  };
}

export type LoggedSet = {
  day: string;
  exercise: string;
  weight: number | null;
  reps: number | null;
  sets: number;
  pin: string | null;
  /** Set when the row came from the app's exercise library, which carries its
   *  own muscle data. Preferred over the name-based map, because a library
   *  name ("Barbell Full Squat") is not in the typed-log vocabulary. */
  primary_muscle?: string | null;
  secondary_muscles?: string[] | null;
};

/** Muscles for a logged set: the library's own data when the row has it,
 *  otherwise the name map built from the typed-log vocabulary. */
export function musclesForSet(r: LoggedSet): [string, number][] {
  if (r.primary_muscle) {
    return [
      [r.primary_muscle.toLowerCase(), 1.0] as [string, number],
      ...(r.secondary_muscles ?? []).map(
        (m) => [m.toLowerCase(), 0.5] as [string, number]),
    ];
  }
  return musclesFor(r.exercise);
}

type Rec = Record<string, any>;

/* ------------------------------------------------------------------ dates */

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (day: string, n: number) => iso(new Date(Date.parse(day) + n * DAY));

/** WHOOP timestamps are UTC; each record carries the offset it happened in. */
function localDay(ts: string, offset?: string | null): string {
  let off = offset ?? "+00:00";
  if (off.length < 6 || !"+-".includes(off[0])) off = "+00:00";
  const sign = off[0] === "+" ? 1 : -1;
  const mins = sign * (parseInt(off.slice(1, 3)) * 60 + parseInt(off.slice(4, 6)));
  return iso(new Date(Date.parse(ts) + mins * 60_000));
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/* ------------------------------------------------------------------ state */

/** Sessions that barely register the next morning and would muddy a sport's cost. */
const BACKGROUND = new Set(["walking", "meditation", "activity", "yoga", "stretching"]);
/** Below this many clean sessions a measured cost is noise, and is not used. */
export const MIN_MEASURED = 5;
/** Stand-in costs, by how hard the athlete rates the activity. */
export const INTENSITY_COST: Record<Intensity, number> = { easy: -1, moderate: -3, hard: -5 };

/** Per sport, each day it was done: the next-morning residual when that day
 *  can be measured, null when it cannot (another real session the same day,
 *  or no recovery score the next morning). */
export type SportDays = Record<string, Record<string, number | null>>;

/**
 * Every sport in a stretch of WHOOP history, with what it cost on each day:
 * the next morning's recovery against what mean reversion alone predicts (a
 * bad morning tends to be followed by a better one and the reverse, whatever
 * happened in between). Only days where that sport was the one real session
 * are measured, so a run and a match on the same day are not blamed on either.
 */
function recoveryByDay(w: Rec): Record<string, number> {
  const rec: Record<string, number> = {};
  for (const r of w.recovery ?? [])
    if (r.score?.recovery_score != null) rec[localDay(r.created_at)] = r.score.recovery_score;
  return rec;
}

/** Tomorrow's recovery as mean reversion alone predicts it from today's: the
 *  baseline every session is measured against. Null until there are twenty
 *  consecutive-morning pairs to fit it on. */
function meanReversion(rec: Record<string, number>): ((today: number) => number) | null {
  const pairs: [number, number][] = [];
  for (const d of Object.keys(rec))
    if (rec[shift(d, 1)] != null) pairs.push([rec[d], rec[shift(d, 1)]]);
  if (pairs.length < 20) return null;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  const sxx = pairs.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  const slope = sxx ? pairs.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / sxx : 0;
  return (today) => slope * today + (my - slope * mx);
}

export function whoopSportDays(w: Rec): SportDays {
  const rec = recoveryByDay(w);

  const sportsByDay: Record<string, Set<string>> = {};
  for (const x of w.workouts ?? [])
    if (x.sport_name)
      (sportsByDay[localDay(x.start, x.timezone_offset)] ??= new Set()).add(String(x.sport_name));

  const predict = meanReversion(rec);

  const out: SportDays = {};
  for (const [d, sports] of Object.entries(sportsByDay)) {
    const real = [...sports].filter((s) => !BACKGROUND.has(s));
    const next = rec[shift(d, 1)];
    const measurable = predict && real.length === 1 && rec[d] != null && next != null;
    for (const s of real)
      (out[s] ??= {})[d] = measurable ? Math.round((next - predict!(rec[d])) * 10) / 10 : null;
  }
  return out;
}

/* ------------------------------------------------------------- learning */

/** The lift kind of each logged day: "legs", "push" or "pull". */
export function liftKindByDay(sets: LoggedSet[]): Record<string, string> {
  const byDay = volumeByDay(sets);
  const out: Record<string, string> = {};
  for (const [d, vol] of Object.entries(byDay)) {
    if (Object.values(vol).reduce((a, b) => a + b, 0) < 2) continue;
    const k = classifyDay(vol);
    out[d] = k.startsWith("legs") ? "legs" : k;
  }
  return out;
}

/** A run of this length or more counts as the long run, not an easy one. */
const LONG_RUN_MIN = 45;

/**
 * What the athlete did on each day the WHOOP history covers: lifts from their
 * log, runs and sports from WHOOP, and "rest" for a day with none of them.
 * These are the things the plan schedules, so they are the things worth
 * knowing the price of.
 */
export function dayKinds(w: Rec, sets: LoggedSet[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of Object.keys(recoveryByDay(w))) out[d] = [];
  for (const x of w.workouts ?? []) {
    const sport = String(x.sport_name ?? "");
    if (!sport || BACKGROUND.has(sport)) continue;
    const d = localDay(x.start, x.timezone_offset);
    if (!(d in out)) continue;
    if (sport === "running") {
      const min = (Date.parse(x.end) - Date.parse(x.start)) / 60_000;
      out[d].push(min >= LONG_RUN_MIN ? "run:long" : "run:easy");
    } else out[d].push(`sport:${sport}`);
  }
  for (const [d, kind] of Object.entries(liftKindByDay(sets)))
    if (d in out) out[d].push(`lift:${kind}`);
  // A WHOOP "weightlifting" entry on a day with a logged lift is that lift,
  // recorded twice, not a second session.
  for (const d of Object.keys(out))
    if (out[d].some((k) => k.startsWith("lift:")))
      out[d] = out[d].filter((k) => k !== "sport:weightlifting" && k !== "sport:functional_fitness");
  return out;
}

/**
 * What each kind of day cost, day by day: the next morning's recovery against
 * what mean reversion alone predicts. A day with two things on it is measured
 * as the pair ("lift:pull+run:easy"), never as either alone, so a run and a
 * lift do not get blamed for each other. A day with nothing is "rest", which
 * is worth measuring too: it is what everything else is compared to.
 */
export function measureKindDays(w: Rec, kinds: Record<string, string[]>): SportDays {
  const rec = recoveryByDay(w);
  const predict = meanReversion(rec);
  const out: SportDays = {};
  for (const [d, ks] of Object.entries(kinds)) {
    const key = [...new Set(ks)].sort().join("+") || "rest";
    const next = rec[shift(d, 1)];
    const measurable = predict && rec[d] != null && next != null;
    (out[key] ??= {})[d] = measurable ? Math.round((next - predict!(rec[d])) * 10) / 10 : null;
  }
  return out;
}

/** Days of the athlete's own history a default is worth. Four means a single
 *  bad morning barely moves the number; twenty measured days all but replace
 *  the default. */
const PRIOR_WEIGHT = 4;

/** The default cost of a kind of day before the athlete's own history says
 *  otherwise. Pairs add. Sports take the intensity the athlete gave them. */
export function priorCost(kind: string, tun: Tunables, activities: Activity[]): number {
  return kind.split("+").reduce((sum, k) => {
    if (k === "rest") return sum + 2;
    if (k === "run:easy") return sum + Math.max(tun.cost_running, -6);
    if (k === "run:long") return sum + tun.cost_running;
    if (k === "lift:legs") return sum + tun.cost_legs_quad;
    if (k.startsWith("lift:")) return sum + tun.cost_lift_upper;
    if (k.startsWith("sport:")) {
      const a = activities.find((x) => `sport:${x.sport}` === k);
      return sum + (a ? INTENSITY_COST[a.intensity] : -3);
    }
    return sum;
  }, 0);
}

/**
 * The cost of every kind of day this athlete has had, blended: the default
 * until their own mornings say otherwise, then more and more their own number.
 * An explicit `cost_<kind>` in the profile's tunables wins outright.
 */
export function learnedCosts(days: SportDays, tun: Tunables, activities: Activity[]):
    Record<string, ActivityCost> {
  const out: Record<string, ActivityCost> = {};
  const tunables = tun as unknown as Record<string, unknown>;
  for (const [kind, byDay] of Object.entries(days)) {
    const res = Object.values(byDay).filter((v): v is number => v != null);
    const override = tunables[`cost_${kind.replace(/[^a-z0-9]+/g, "_")}`];
    const prior = priorCost(kind, tun, activities);
    const n = res.length;
    if (typeof override === "number") { out[kind] = { value: override, n, source: "profile" }; continue; }
    const value = Math.round(((n * mean(res) + PRIOR_WEIGHT * prior) / (n + PRIOR_WEIGHT)) * 10) / 10;
    out[kind] = { value, n, source: n >= MIN_MEASURED ? "measured" : "default" };
  }
  return out;
}

/** "lift:pull+run:easy" -> "Pull lift + easy run". */
export function kindLabel(kind: string): string {
  return kind.split("+").map((k) => {
    if (k === "rest") return "Rest day";
    if (k === "run:easy") return "easy run";
    if (k === "run:long") return "long run";
    if (k.startsWith("lift:")) return `${LIFT_LABEL[k.slice(5)] ?? k.slice(5)} lift`.replace("Leg day lift", "Leg day").replace(" lift lift", " lift");
    if (k.startsWith("sport:")) return k.slice(6).replace(/_/g, " ");
    return k;
  }).join(" + ").replace(/^./, (c) => c.toUpperCase());
}

/** Joins two stretches of history. A measured day beats an unmeasured one, and
 *  a newer measurement of the same day beats an older one. */
export function mergeSportDays(older: SportDays, newer: SportDays): SportDays {
  const out: SportDays = {};
  for (const src of [older, newer])
    for (const [sport, days] of Object.entries(src ?? {}))
      for (const [d, v] of Object.entries(days ?? {}))
        if (v != null || out[sport]?.[d] == null) (out[sport] ??= {})[d] = v;
  return out;
}

/** Per sport: days done, days measured, and the cost once enough are measured. */
export function summarizeSportDays(days: SportDays) {
  return Object.entries(days)
    .map(([sport, byDay]) => {
      const res = Object.values(byDay).filter((v): v is number => v != null);
      return {
        sport,
        sessions: Object.keys(byDay).length,
        n: res.length,
        cost: res.length >= MIN_MEASURED ? Math.round(mean(res) * 10) / 10 : null,
      };
    })
    .sort((a, b) => b.sessions - a.sessions);
}

export function whoopSportSummary(w: Rec) {
  return summarizeSportDays(whoopSportDays(w));
}

/**
 * The recovery cost used for each activity: a value set on the profile wins,
 * then one measured from WHOOP, then a stand-in for how hard it is rated.
 */
export function activityCosts(activities: Activity[],
                              summary: ReturnType<typeof whoopSportSummary>,
                              tunables: Record<string, any>): Record<string, ActivityCost> {
  const out: Record<string, ActivityCost> = {};
  for (const a of activities) {
    const override = tunables[`cost_${a.sport.replace(/[^a-z0-9]+/g, "_")}`];
    const seen = summary.find((s) => s.sport === a.sport);
    out[a.sport] = typeof override === "number"
      ? { value: override, n: seen?.n ?? 0, source: "profile" }
      : seen?.cost != null
        ? { value: seen.cost, n: seen.n, source: "measured" }
        : { value: INTENSITY_COST[a.intensity], n: seen?.n ?? 0, source: "default" };
  }
  return out;
}

export function buildState(w: Rec) {
  const rec: Record<string, Rec> = {};
  for (const r of w.recovery) if (r.score) rec[localDay(r.created_at)] = r.score;

  const sleep: Record<string, Rec> = {};
  for (const s of w.sleep)
    if (s.score && !s.nap) sleep[localDay(s.start, s.timezone_offset)] = s.score;

  const strain: Record<string, number> = {};
  for (const c of w.cycles)
    if (c.score) strain[localDay(c.start, c.timezone_offset)] = c.score.strain;

  const workouts: Record<string, Rec[]> = {};
  for (const x of w.workouts) {
    if (!x.score) continue;
    const d = localDay(x.start, x.timezone_offset);
    (workouts[d] ??= []).push(x);
  }

  const days = Object.keys(rec).sort();
  const today = days[days.length - 1];
  const r = rec[today];

  const within30 = days.filter((d) => d > shift(today, -30));
  const hist = within30.map((d) => rec[d].hrv_rmssd_milli);
  const rhist = within30.map((d) => rec[d].recovery_score);
  const rhrHist = within30.map((d) => rec[d].resting_heart_rate);

  // Consecutive mornings HRV has sat below its own band. One is noise.
  let hrvStreak = 0;
  if (hist.length > 2) {
    const band = mean(hist) - sd(hist);
    for (const d of [...days].reverse()) {
      if (rec[d].hrv_rmssd_milli < band) hrvStreak++;
      else break;
    }
  }

  const runMinutes = (from: string, to: string) => {
    let m = 0;
    for (const [d, xs] of Object.entries(workouts)) {
      if (d < from || d >= to) continue;
      for (const x of xs)
        if (x.sport_name === "running")
          m += (Date.parse(x.end) - Date.parse(x.start)) / 60_000;
    }
    return Math.round(m);
  };

  const sl = sleep[today] ?? {};
  const stage = sl.stage_summary ?? {};
  const need = sl.sleep_needed ?? {};
  const sleptH =
    ((stage.total_in_bed_time_milli ?? 0) - (stage.total_awake_time_milli ?? 0)) /
    3.6e6;

  return {
    date: today,
    dow: DOW[(new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7],
    recovery: r.recovery_score,
    hrv: r.hrv_rmssd_milli,
    hrv_baseline: hist.length ? mean(hist) : null,
    hrv_sd: hist.length > 1 ? sd(hist) : 0,
    rhr: r.resting_heart_rate,
    recovery_baseline: rhist.length ? mean(rhist) : null,
    rhr_baseline: rhrHist.length ? mean(rhrHist) : null,
    sleep_hours: Math.round(sleptH * 10) / 10,
    sleep_debt_h:
      Math.round(((need.need_from_sleep_debt_milli ?? 0) / 3.6e6) * 10) / 10,
    sleep_performance: sl.sleep_performance_percentage ?? null,
    strain_yesterday: Math.round((strain[shift(today, -1)] ?? 0) * 10) / 10,
    hrv_low_streak: hrvStreak,
    run_minutes_this_week: runMinutes(shift(today, -7), shift(today, 1)),
    run_minutes_last_week: runMinutes(shift(today, -14), shift(today, -7)),
    _workouts: workouts,
  };
}

/** Consecutive recent weeks containing at least `perWeek` runs.
 *  Readiness gates run off this, not off weeks-until-race: the calendar has
 *  no idea whether the training actually happened. */
export function runConsistencyWeeks(workouts: Record<string, any[]>,
                                    today: string, perWeek = 2, maxWeeks = 26) {
  let streak = 0;
  for (let w = 0; w < maxWeeks; w++) {
    const end = shift(today, -7 * w), start = shift(today, -7 * (w + 1));
    let n = 0;
    for (const [day, xs] of Object.entries(workouts)) {
      if (day < start || day >= end) continue;
      n += xs.filter((x) => x.sport_name === "running").length;
    }
    if (n >= perWeek) streak++;
    else break;
  }
  return streak;
}

/** What the Ruut readiness criteria permit, given measured consistency. */
export function readiness(weeks: number) {
  return {
    weeks,
    long_runs: weeks >= 4,      // 3-4 weeks consistent
    tempo: weeks >= 10,         // 2-3 months
    intervals: weeks >= 20,     // 4-6 months
  };
}

/* ------------------------------------------------------------------- plan */

/** How far ahead the plan looks when there is no race to count down to. */
export const HORIZON_WEEKS = 12;

export function racePlan(race: PlanInputs["race"], today: string, achievedLongMi: number,
                         longestEver: number) {
  // Without a race the plan still looks twelve weeks ahead: the long run grows
  // gently from wherever it is, with the same cutback every fourth week.
  const weeksOut = race
    ? Math.max(0, Math.floor((Date.parse(race.date) - Date.parse(today)) / (7 * DAY)))
    : HORIZON_WEEKS;
  // Anchored on what has actually been run in the last three weeks, not on a
  // position in a ladder written months ago. Recomputed every morning, so a
  // missed fortnight moves the plan instead of leaving the athlete chasing it.
  const start = Math.max(achievedLongMi, 3.0);
  const peak = race ? race.peakLongMi : Math.max(start, Math.min(start * 1.5, 8));
  const build = race ? Math.max(1, weeksOut - 3) : HORIZON_WEEKS;
  const growthWeeks = Math.max(1, build - 1 - Math.floor((build - 1) / 4));

  // What growth rate would be needed, and what is actually safe.
  const needed = (peak / start) ** (1 / growthWeeks);
  const SAFE = 1.10;                      // the 10% rule, as a hard ceiling
  const growth = Math.min(needed, SAFE);
  const onTrack = needed <= SAFE;

  const schedule: number[] = [];
  let cur = start;
  for (let i = 0; i < build; i++) {
    const lastBuild = i === build - 1;
    if (i > 0 && i % 4 === 3 && !lastBuild) {
      schedule.push(Math.round(cur * 0.7 * 10) / 10);
    } else {
      if (i > 0) cur = Math.min(peak, cur * growth);
      schedule.push(Math.round(cur * 10) / 10);
    }
  }
  // Where the build actually lands at a safe growth rate.
  const reachable = Math.round(schedule[schedule.length - 1] * 10) / 10;
  if (race)
    schedule.push(
      Math.round(reachable * 0.72 * 10) / 10,
      Math.round(reachable * 0.45 * 10) / 10,
      race.miles,
    );

  // The easy run is anchored on reality too: someone already running 6-mile
  // long runs is not doing 25-minute midweek runs, and pretending otherwise
  // would have the plan prescribe less than he already does.
  const easyBase = Math.min(70, Math.max(25, Math.round((start * 10) / 1.8 / 5) * 5));
  const easyMinutes = (weekIdx: number) =>
    Math.min(70, easyBase + Math.floor(weekIdx / 3) * 5);
  const ratio = (easyMin: number) => (easyMin >= 45 ? 1.8 : 1.4);
  // The ratio caps GROWTH, never the anchor. It should stop the long run
  // running away from the easy run; it should not prescribe going backwards
  // from a distance already covered.
  const cap = (weekIdx: number) => {
    const e = easyMinutes(weekIdx);
    return Math.max(start, Math.round((e * ratio(e)) / 10 * 10) / 10);
  };

  const thisWeekRaw = schedule[0];
  return {
    race_date: race?.date ?? null,
    race_miles: race?.miles ?? null,
    has_race: Boolean(race),
    weeks_out: weeksOut,
    long_run_this_week_mi: Math.min(thisWeekRaw, cap(0)),
    easy_run_minutes: easyMinutes(0),
    long_run_uncapped_mi: thisWeekRaw,
    long_run_capped: thisWeekRaw > cap(0),
    schedule_all: schedule,
    week_index: 0,
    anchored_on_mi: start,
    growth_per_week: Math.round((growth - 1) * 1000) / 10,
    needed_growth_per_week: Math.round((needed - 1) * 1000) / 10,
    on_track: onTrack,
    reachable_peak_mi: reachable,
    longest_ever_mi: longestEver,
  };
}

/** Meso cycles: 4-week blocks, each with ONE job, each ending in a recovery
 *  week. "If you try to do all of them at once, nothing improves."
 *
 *  Blocks advance on weeks actually trained, not on weeks elapsed. Miss a
 *  fortnight and the phase waits for you rather than moving on without you. */
export function mesocycle(consistencyWeeks: number, weeksOut: number) {
  const phases = [
    { name: "Aerobic base", job: "3-4 easy runs, one slightly longer. No tempo, no intervals. Strength twice a week." },
    { name: "Volume tolerance", job: "Longer easy runs, long run grows 5-10 min per week. Still all easy." },
    { name: "Volume progression", job: "Easy volume keeps climbing. The long run is the only session that changes much." },
    { name: "Tempo introduction", job: "One tempo a week, inside an easy session. Long run stays controlled -- never add length and intensity together." },
    { name: "Race-specific endurance", job: "The long run reaches its peak. Tempo holds at one a week, nothing more." },
    { name: "Sharpening", job: "Volume eases, a little speed returns. Nothing new is learned here -- it is all consolidation." },
  ];
  const block = Math.floor(consistencyWeeks / 4);
  const weekInBlock = consistencyWeeks % 4;
  const taper = weeksOut <= 3;
  const phase = phases[Math.min(block, phases.length - 1)];
  return {
    phase: taper ? "Taper" : phase.name,
    job: taper
      ? "Volume down, intensity low, sleep up. The work is already done."
      : phase.job,
    week_in_block: weekInBlock + 1,
    // The build never ends on a cutback, so the week before the taper is the
    // peak, not a recovery week.
    recovery_week: !taper && weekInBlock === 3 && weeksOut > 4,
  };
}

export type Slot = [string, string];

const DAY_NAME: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

const LIFTS = new Set(["legs", "pull", "push", "upper", "full body"]);
const LIFT_LABEL: Record<string, string> = {
  legs: "Leg day", pull: "Pull lift", push: "Push lift",
  upper: "Upper-body lift", "full body": "Full-body lift",
};

/** The lift in a session kind: "pull+run" -> "pull", "long run" -> null. */
export function liftOf(kind: string): string | null {
  const base = kind.endsWith("+run") ? kind.slice(0, -4) : kind;
  return LIFTS.has(base) ? base : null;
}

const hasEasyRun = (kind: string) => kind === "run" || kind.endsWith("+run");

/** The lifts a week holds, by how many lifting days the athlete wants. */
const LIFT_SPLITS: string[][] = [
  [],
  ["full body"],
  ["legs", "upper"],
  ["legs", "pull", "push"],
  ["legs", "pull", "push", "legs"],
  ["legs", "pull", "push", "legs", "upper"],
];

/** A run stacks onto the cheapest lift available: pull first, push last. */
const STACK_ORDER = ["pull", "upper", "full body", "push"];

const ACTIVITY_NOTE: Record<Intensity, string> = {
  hard: "Biggest session of your week.",
  moderate: "A real session. Plan around it.",
  easy: "Light. It barely costs recovery.",
};

/**
 * A normal week, built from the athlete's answers: their activities on their
 * days, the long run on its weekend day, a rest day after it, and lifts and
 * easy runs spread over what is left.
 */
export function weekTemplate(
  p: Pick<PlanInputs, "activities" | "liftDays" | "runDays" | "longRunDay" | "race">,
): Record<string, Slot> {
  const t: Record<string, Slot> = {};

  // Fixed commitments first: they happen on those days whatever the plan says.
  // Where two share a day, the one listed first keeps it.
  for (const a of p.activities)
    for (const d of a.days)
      t[d] ??= [a.sport, `${a.label}${a.time ? " " + clock(a.time) : ""}. ${ACTIVITY_NOTE[a.intensity]}`];

  // The long run takes its weekend day, or the other one if an activity has it.
  let longDay: string | null = null;
  if (p.runDays >= 1) {
    const other = p.longRunDay === "Sat" ? "Sun" : "Sat";
    longDay = !t[p.longRunDay] ? p.longRunDay : !t[other] ? other : null;
    if (longDay)
      t[longDay] = ["long run", p.race
        ? "The long run. The session the race is built on."
        : "The long run. Easy, and the longest of the week."];
  }
  const longName = DAY_NAME[longDay ?? p.longRunDay];

  // One protected rest day: the day after the long run.
  const anchor = (longDay ?? p.longRunDay) as (typeof DOW)[number];
  const restDay = DOW[(DOW.indexOf(anchor) + 1) % 7];
  const reserveRest = !t[restDay];
  const free: string[] = DOW.filter((d) => !t[d] && d !== restDay);

  const lifts = LIFT_SPLITS[p.liftDays] ?? LIFT_SPLITS[3];
  const weekdayLongRun = p.runDays >= 1 && !longDay;
  const easyRuns = Math.max(0, p.runDays - 1);
  const liftNote = (k: string) =>
    k === "legs" ? `Leg day. Furthest point from ${longName}'s long run.`
    : k === "push" ? `Push lift. Legs stay fresh for ${longName}.`
    : k === "upper" ? "Upper-body lift: whichever of push or pull is due."
    : k === "full body" ? "Full-body lift."
    : "Pull lift.";

  // Runs get their own days while there is room. The rest stack onto lifts,
  // cheapest lift first and one run per lift; any still left do not fit.
  const ownDays = Math.max(0, free.length - lifts.length - (weekdayLongRun ? 1 : 0));
  let ownRuns = Math.min(easyRuns, ownDays);
  let toStack = easyRuns - ownRuns;
  const stacked = new Set<number>();
  for (const k of STACK_ORDER)
    lifts.forEach((l, i) => {
      if (toStack > 0 && l === k && !stacked.has(i)) { stacked.add(i); toStack--; }
    });

  const queue: Slot[] = [];
  if (weekdayLongRun)
    queue.push(["long run", "The long run, on a weekday: both weekend days are taken."]);
  lifts.forEach((k, i) => {
    queue.push(stacked.has(i)
      ? [`${k}+run`, `${LIFT_LABEL[k]} plus the easy run — the cheapest two to stack.`]
      : [k, liftNote(k)]);
    if (ownRuns > 0) { queue.push(["run", "Easy zone 2 run, on its own day."]); ownRuns--; }
  });
  for (; ownRuns > 0; ownRuns--) queue.push(["run", "Easy zone 2 run, on its own day."]);

  free.forEach((d, i) => { if (queue[i]) t[d] = queue[i]; });

  // A week too full for everything: rather than drop a session silently, the
  // cheapest one left over takes the rest day. Upper-body work costs so little
  // (about 0.6 recovery points) that it can sit the day after the long run.
  const leftover = queue.slice(free.length);
  if (leftover.length && reserveRest) {
    const upper = [...leftover].reverse()
      .find(([k]) => ["push", "pull", "upper"].includes(liftOf(k) ?? ""));
    const [kind] = upper ?? leftover[leftover.length - 1];
    t[restDay] = [kind,
      `${kind === "push" ? "Push" : liftOf(kind) ? "Lift" : "Session"} day, moved to ${DAY_NAME[restDay]} — `
      + `the week is full${upper ? " and upper body is the cheapest session to put here" : ""}.`];
  } else if (reserveRest) {
    t[restDay] = ["rest", "Rest, or a walk."];
  }

  for (const d of DOW) t[d] ??= ["rest", "Nothing scheduled."];
  return t;
}

/* ---------------------------------------------------------------- lifting */

export function classifyDay(vol: Record<string, number>): string {
  const g = (k: string) => vol[k] ?? 0;
  const low = LOWER.reduce((a, b) => a + g(b), 0);
  const up = ["chest", "shoulders", "triceps", "back", "biceps", "forearms"]
    .reduce((a, b) => a + g(b), 0);
  if (low > up * 1.5) {
    if (g("adductors") + g("abductors") > 3) return "legs-hip";
    if (g("hamstrings") + g("calves") > g("quadriceps")) return "legs-posterior";
    return "legs-quad";
  }
  return g("chest") + g("triceps") > g("back") + g("biceps") ? "push" : "pull";
}

function volumeByDay(sets: LoggedSet[]) {
  const byDay: Record<string, Record<string, number>> = {};
  for (const r of sets) {
    for (const [m, w] of musclesForSet(r)) {
      const b = bucket(m);
      (byDay[r.day] ??= {})[b] = (byDay[r.day][b] ?? 0) + r.sets * w;
    }
  }
  return byDay;
}

export function lastSessionOf(sets: LoggedSet[], kind: string) {
  const byDay = volumeByDay(sets);
  const days = Object.keys(byDay)
    .filter((d) => Object.values(byDay[d]).reduce((a, b) => a + b, 0) >= 2 &&
                   classifyDay(byDay[d]) === kind)
    .sort()
    .reverse();
  if (!days.length) return { day: null as string | null, exercises: [] as LoggedSet[] };

  const day = days[0];
  // "Bench: 95 x 10, 8" is logged as one row per set, so the heaviest row leads
  // and the set count is everything done on that exercise that day.
  const best: Record<string, LoggedSet> = {};
  const total: Record<string, number> = {};
  for (const r of sets) {
    if (r.day !== day) continue;
    const k = r.exercise.trim();
    total[k] = (total[k] ?? 0) + r.sets;
    if (!best[k] || (r.weight ?? 0) > (best[k].weight ?? 0)) best[k] = r;
  }
  return { day, exercises: Object.values(best).map((r) => ({ ...r, sets: total[r.exercise.trim()] })) };
}

/** More weight only when it's been earned: same top set 3 sessions, green day. */
export function progression(sets: LoggedSet[], name: string, weight: number | null,
                            level: string, stale = 3,
                            manualLifts: string[] = []): number | null {
  if (level !== "green" || !weight) return null;
  const low = name.trim().toLowerCase();
  // Lifts the athlete progresses by hand -- an injury, a rehab block -- are
  // never bumped automatically. The list is profile data, not code.
  if (manualLifts.some((k) => low.includes(k.toLowerCase()))) return null;

  const tops: Record<string, number> = {};
  for (const r of sets)
    if (r.exercise.trim().toLowerCase() === low && r.weight)
      tops[r.day] = Math.max(tops[r.day] ?? 0, r.weight);
  const recent = Object.keys(tops).sort().reverse().slice(0, stale).map((d) => tops[d]);
  if (recent.length < stale || new Set(recent).size !== 1) return null;

  const step = weight >= 200 ? 10 : weight >= 40 ? 5 : 2.5;
  return weight + step;
}

export function loadWarnings(sets: LoggedSet[], today: string, tun: Tunables) {
  const by: Record<string, { day: string; w: number }[]> = {};
  for (const r of sets)
    if (r.weight) (by[r.exercise.trim().toLowerCase()] ??= []).push({ day: r.day, w: r.weight });

  const out = [];
  for (const [ex, vals] of Object.entries(by)) {
    const tops: Record<string, number> = {};
    for (const v of vals) tops[v.day] = Math.max(tops[v.day] ?? 0, v.w);
    const ds = Object.keys(tops).sort();
    if (ds.length < 2) continue;
    const last = ds[ds.length - 1], prev = ds[ds.length - 2];
    if (last < shift(today, -21)) continue;
    const jump = (tops[last] - tops[prev]) / tops[prev];
    // Switching between dumbbells and a machine under one name is not a jump.
    const seenBefore = vals.some((v) => v.day !== last && v.w === tops[last]);
    if (jump > tun.max_load_jump && !seenBefore)
      out.push({ exercise: ex, from: tops[prev], to: tops[last],
                 pct: Math.round(jump * 100), date: last });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

export function imbalances(sets: LoggedSet[], today: string, weeks = 8) {
  const cut = shift(today, -weeks * 7);
  const vol: Record<string, number> = {};
  for (const r of sets) {
    if (r.day < cut) continue;
    for (const [m, w] of musclesForSet(r)) {
      const b = bucket(m);
      vol[b] = (vol[b] ?? 0) + r.sets * w;
    }
  }
  const per: Record<string, number> = {};
  for (const [k, v] of Object.entries(vol)) per[k] = Math.round((v / weeks) * 10) / 10;

  const flags = [];
  const back = per.back ?? 0;
  const arms = (per.biceps ?? 0) + (per.forearms ?? 0);
  if (arms && back / arms < 1.0)
    flags.push({ severity: "high", title: "Back work is half your arm work",
      detail: `back ${back}/wk vs biceps+forearms ${arms}/wk (ratio ${(back / arms).toFixed(2)}). Add a vertical pull.` });
  if ((per.abdominals ?? 0) < 2)
    flags.push({ severity: "medium", title: "Core is essentially untrained",
      detail: `${per.abdominals ?? 0} sets/wk.` });
  if ((per.calves ?? 0) < 2)
    flags.push({ severity: "medium", title: "Calf volume is low while running volume climbs",
      detail: `${per.calves ?? 0} sets/wk. Calves and shins take the load as mileage rises.` });
  return { per_week: per, flags };
}

/** Where training time actually sits, against the polarized model.
 *  Easy = zones 0-2, threshold = zone 3, hard = zones 4-5. */
export function intensityDistribution(workouts: Record<string, any[]>,
                                      today: string, days = 60) {
  const cut = shift(today, -days);
  let easy = 0, thr = 0, hard = 0;
  for (const [day, xs] of Object.entries(workouts)) {
    if (day < cut) continue;
    for (const x of xs) {
      const z = x.score?.zone_durations;
      if (!z) continue;
      easy += (z.zone_zero_milli ?? 0) + (z.zone_one_milli ?? 0) + (z.zone_two_milli ?? 0);
      thr  += z.zone_three_milli ?? 0;
      hard += (z.zone_four_milli ?? 0) + (z.zone_five_milli ?? 0);
    }
  }
  const tot = easy + thr + hard;
  if (!tot) return null;
  return {
    easy: easy / tot, threshold: thr / tot, hard: hard / tot,
    hard_minutes: Math.round(hard / 60000), total_minutes: Math.round(tot / 60000),
  };
}

/** Flags that come from the research protocols rather than from volume. */
export function protocolFlags(dist: ReturnType<typeof intensityDistribution>,
                              opts: { template?: Record<string, Slot>; cadenceSpm?: number | null } = {}) {
  const flags = [];
  if (dist) {
    if (dist.hard < INTENSITY_TARGET.hard_min)
      flags.push({ severity: "high",
        title: "Almost no hard work in the last 60 days",
        detail: `${dist.hard_minutes} min in zones 4-5 out of ${dist.total_minutes} ` +
                `(${(dist.hard * 100).toFixed(1)}%). Polarized training is ~80% easy ` +
                `AND ~20% hard, not all easy. Note this is argued from the training ` +
                `distribution itself, not from the VO2 max estimate -- that number ` +
                `tracks how hard recent runs were, on 2-3 runs a month, so it cannot ` +
                `settle the question either way.` });
    if (dist.threshold > INTENSITY_TARGET.threshold_max)
      flags.push({ severity: "medium",
        title: "Too much time at threshold",
        detail: `${(dist.threshold * 100).toFixed(1)}% in zone 3. That is the zone ` +
                `that costs the most recovery for the least adaptation.` });
  }
  // Counted from the actual week, so the flag only appears when it is true.
  const restDays = opts.template
    ? Object.values(opts.template).filter(([kind]) => kind === "rest").length
    : null;
  if (restDays !== null && restDays < 2)
    flags.push({ severity: "medium",
      title: `${restDays === 0 ? "No rest days" : "One rest day"} a week, against an HRV goal`,
      detail: "The HRV-shaped week is 3-4 easy cardio days, at most one hard, and " +
              `2-3 days of rest or active recovery. This week has ${restDays}. That is ` +
              "trainable, but it is not an HRV-maximising week -- worth knowing " +
              "which you are choosing." });
  // WHOOP has no cadence, so the flag only exists once one has been entered.
  const cadence = opts.cadenceSpm ?? null;
  if (cadence !== null && cadence < CADENCE_TARGET.target_low)
  flags.push({ severity: "low", title: "Cadence is below the tibial-load threshold",
    detail: `Last measured ${cadence} spm; target ` +
            `${CADENCE_TARGET.target_low}-${CADENCE_TARGET.target_high}. WHOOP does ` +
            `not report cadence, so this comes from your watch and has to be ` +
            `entered by hand. Worth knowing, not worth chasing yet -- forcing ` +
            `technique before running is consistent tends to create tension ` +
            `rather than prevent injury.` });
  return flags;
}

/* --------------------------------------------------------- prescription */

/** One extra exercise per session type. These are neutral defaults; a profile
 *  can replace any of them (`additions`) with loads and reasons drawn from that
 *  athlete's own history. */
const ADDITIONS: Record<string, [string, string, string]> = {
  legs: ["Calf raises", "3 x 25",
    "Calves and shins take the load as running volume climbs."],
  "pull+run": ["Lat pulldowns", "3 x 12",
    "A vertical pull, to balance rows and curls."],
  pull: ["Lat pulldowns", "3 x 12",
    "A vertical pull, to balance rows and curls."],
  push: ["Face pulls", "3 x 12",
    "Rear delts and scapular control, to balance the pressing."],
  upper: ["Face pulls", "3 x 12",
    "Rear delts and scapular control, whichever half of the upper body is due."],
  rest: ["Ab circuit", "10 min",
    "Core work fits best on a rest day."],
  legs2: ["Mobility and isometric block", "15 min",
    "Second of two weekly sessions. Ankle holds, calf holds, hip bridge, side " +
    "plank. Tendons take months to strengthen; this is the quiet foundation."],
  "long run": ["Mobility and isometric block", "15 min after the run",
    "Ankle holds 2x45s, bent-knee calf holds 2x40s, hip bridge 3x30s, side " +
    "plank 2x30s. Joint and tendon work -- the insurance for rising mileage, " +
    "and it hits calves, core and shins at once."],
};

/** Muscle groups an athlete can ask to bring up, each with the extra exercise
 *  that does it and the session kinds it belongs in ("*" = any day). */
export const FOCUS_MUSCLES = ["chest", "back", "shoulders", "arms", "core", "glutes", "quads", "hamstrings", "calves"] as const;
const FOCUS_ADDITIONS: Record<string, { fits: string[]; add: [string, string, string] }> = {
  chest: { fits: ["push", "upper", "full body"],
    add: ["Incline dumbbell press", "3 x 10", "Upper chest, the part flat pressing leaves behind. One of your focus areas."] },
  back: { fits: ["pull", "upper", "full body"],
    add: ["Lat pulldowns", "3 x 12", "A vertical pull for width. One of your focus areas."] },
  shoulders: { fits: ["push", "upper", "full body"],
    add: ["Lateral raises", "3 x 15", "Side delts: the part pressing does not build. One of your focus areas."] },
  arms: { fits: ["pull", "push", "upper", "full body"],
    add: ["Curls and pressdowns, superset", "3 x 12 each", "Direct arm work. One of your focus areas."] },
  core: { fits: ["*"],
    add: ["Ab circuit", "10 min", "Core is one of your focus areas, and it fits on any day."] },
  glutes: { fits: ["legs", "full body"],
    add: ["Hip thrusts", "3 x 12", "Glutes: the biggest muscle in the body and the least trained by machines. One of your focus areas."] },
  quads: { fits: ["legs", "full body"],
    add: ["Leg extensions", "3 x 15", "Isolated quad volume. One of your focus areas."] },
  hamstrings: { fits: ["legs", "full body"],
    add: ["Romanian deadlift", "3 x 10", "Hamstrings at length, which most leg days skip. One of your focus areas."] },
  calves: { fits: ["*"],
    add: ["Calf raises", "3 x 25", "Calves are one of your focus areas, and they fit on any day."] },
};

/** The first focus muscle whose addition belongs in today's session, if any. */
function focusAddition(focus: string[], planned: string, lift: string | null) {
  for (const m of focus) {
    const f = FOCUS_ADDITIONS[m];
    if (f && f.fits.some((k) => k === "*" || k === planned || k === lift)) return f.add;
  }
  return null;
}

/**
 * Where an exercise belongs in a session. The lift that asks the most goes
 * first, while the athlete is fresh and form is best; isolation work goes
 * last because it does not care how tired they are.
 *   0  the day's main compound lift (squat, hack, leg press, deadlift, bench, press)
 *   1  secondary compounds: unilateral, hinge, rows, pulls
 *   2  isolation
 *   3  finishers: calves and core
 * Checked from the bottom up, because "single leg calf raise" is a calf
 * exercise and "tricep pulldown" is not a lat pulldown.
 */
export function exerciseTier(name: string, muscle?: string | null): number {
  const n = name.toLowerCase();
  const m = (muscle ?? "").toLowerCase();
  if (/calf|calves|\btib|shin|\babs?\b|abdominal|crunch|plank|torso|\bcore\b|oblique|dead bug|bird dog|hollow|sit ?ups?|leg raise|hanging knee/.test(n)
      || /calves|abdominal|oblique/.test(m)) return 3;
  if (/tricep|bicep|curl|extension|lateral raise|front raise|rear delt|reverse fly|\bfly|flye|pec deck|face pull|kickback|pushdown|pullover|shrug|rotation|inner thigh|outer thigh|adduct|abduct/.test(n)) return 2;
  if (/bulgarian|split squat|lunge|step ?up|\brdl|romanian|good morning|single.?leg|pistol|nordic|hip thrust|glute bridge|\brow|lat pull|pull ?down|pull ?up|chin ?up|\bdip/.test(n)) return 1;
  if (/squat|hack|leg press|deadlift|bench|press|clean|snatch/.test(n)) return 0;
  return 1.5;
}

/** A session's lifts in the order to do them, and how: the compounds as
 *  straight sets, the small stuff as one mini circuit. */
export type SessionBlock = { title: string | null; note: string | null; items: string[] };

export function prescribe(sets: LoggedSet[], planned: string, level: string,
                          z2: number, longMi: number, opts: {
                            hrvStreak?: number; intervalsReady?: boolean;
                            easyMinutes?: number; personal?: Personal;
                            defaultSets?: number;
                            /** Primary muscle of a logged name, from the athlete's alias map. */
                            muscleOf?: (name: string) => string | null | undefined;
                          } = {}) {
  const personal = opts.personal ?? personalFrom({});
  const items: string[] = [];
  const blocks: SessionBlock[] = [];
  let source: string | null = null;

  const lift = liftOf(planned);
  if (lift) {
    // Legs rotate through their three variants, "upper" between push and pull,
    // and full body through all five: whichever was done longest ago.
    const rotation: Record<string, string[]> = {
      legs: ["legs-quad", "legs-hip", "legs-posterior"],
      upper: ["push", "pull"],
      "full body": ["legs-quad", "push", "legs-posterior", "pull", "legs-hip"],
      push: ["push"],
      pull: ["pull"],
    };
    const kind = rotation[lift]
      .map((k) => ({ k, d: lastSessionOf(sets, k).day ?? "0000-00-00" }))
      .sort((a, b) => a.d.localeCompare(b.d))[0].k;
    const { day, exercises } = lastSessionOf(sets, kind);
    source = day;
    // Heaviest first, finishers last; ties keep the order they were logged in.
    const ordered = exercises
      .map((e, i) => ({ e, i, tier: exerciseTier(e.exercise, opts.muscleOf?.(e.exercise)) }))
      .sort((a, b) => a.tier - b.tier || a.i - b.i);
    const straight: string[] = [], circuit: string[] = [];
    for (const { e, tier } of ordered) {
      const load = e.weight ? `${e.weight}` : e.pin ?? "bodyweight";
      // A strength goal earns the next load after two clean sessions, not three.
      const bump = progression(sets, e.exercise, e.weight, level,
                               personal.goals.includes("strength") ? 2 : 3, personal.manualLifts);
      // A short last session (one heavy single, a cut-short day) is not the
      // program: the prescription is at least the default set count.
      const nSets = Math.max(e.sets, opts.defaultSets ?? DEFAULT_TUNABLES.default_sets);
      (tier >= 2 ? circuit : straight).push(
        `${e.exercise} — ${nSets} x ${e.reps ?? "–"} @ ${load}` + (bump ? `  ↑ go to ${bump}` : ""));
    }
    // One lone accessory is not a circuit; it just goes on the end.
    if (circuit.length === 1) straight.push(circuit.pop()!);
    if (straight.length)
      blocks.push({ title: "Straight sets", items: straight,
                    note: "All sets of one lift before the next. Rest 2–3 min between sets on the compounds." });
    if (circuit.length)
      blocks.push({ title: "Mini circuit", items: circuit,
                    note: "One set of each, then round again. About a minute between rounds." });
    items.push(...straight, ...circuit);
  }

  if (planned === "run" || (planned.endsWith("+run") && level === "green")) {
    const base = opts.easyMinutes ?? 25;
    items.push(`Easy run — ${level === "green" ? base : Math.round(base * 0.8)} min, under ${z2} bpm`);
  }
  if (planned === "long run") {
    const mi = level === "green" ? longMi : Math.round(longMi * 0.75 * 10) / 10;
    items.push(`Long run — ${mi} mi, under ${z2} bpm`);
  }
  const activity = personal.activities.find((a) => a.sport === planned);
  if (activity)
    items.push(`${activity.label}${activity.time ? " — " + clock(activity.time) : ""}. That is the whole session.`);

  // Strides: top-end work that costs almost nothing in recovery, which is how
  // the polarized model gets its hard fraction back without a new session.
  if (opts.intervalsReady && level === "green" &&
      hasEasyRun(planned))
    items.push("Strides — 6 x 20s fast, full recovery between");

  // A profile's own additions win, then a focus muscle that fits today, then the defaults.
  let add = personal.additions[planned]
    ?? focusAddition(personal.focusMuscles, planned, lift)
    ?? ADDITIONS[planned] ?? ADDITIONS[lift ?? ""];
  // When HRV is the thing that is off, the breathing protocol outranks whatever
  // else was scheduled: after one low morning when HRV is the athlete's goal,
  // after two otherwise.
  if ((opts.hrvStreak ?? 0) >= (personal.goals.includes("hrv") ? 1 : 2))
    add = ["Slow breathing", "10 min at 6 breaths/min",
           "HRV has been below its band. Slow breathing is the best-evidenced " +
           "way to raise RMSSD: 5-15 ms over 4-6 weeks."];

  if (level === "red")
    return { items: ["Walk if you want to move."], blocks: [], source_date: null, add: null, hold: true };

  // Whatever is not a lift -- the run, the sport, strides -- is its own block.
  const rest = items.filter((i) => !blocks.some((b) => b.items.includes(i)));
  if (rest.length) blocks.push({ title: blocks.length ? "Also today" : null, note: null, items: rest });

  return {
    items,
    blocks,
    source_date: source,
    add: add ? { name: add[0], dose: add[1], why: add[2] } : null,
    hold: level !== "green",
  };
}

/* ------------------------------------------------------------- decision */

export function decide(state: ReturnType<typeof buildState>,
                       plan: ReturnType<typeof racePlan>,
                       template: Record<string, Slot>, tun: Tunables, z2: number,
                       personal: Personal = personalFrom({})) {
  const rec = state.recovery;
  const [planned, why] = template[state.dow];
  let level = rec >= tun.recovery_green ? "green"
            : rec < tun.recovery_red ? "red" : "yellow";

  const reasons = [`Recovery ${Math.round(rec)}% (${level}).`];
  const down = (l: string) => (l === "green" ? "yellow" : "red");

  if (state.sleep_debt_h >= tun.sleep_debt_downgrade) {
    reasons.push(`Sleep debt ${state.sleep_debt_h}h.`);
    level = down(level);
  }
  if (state.hrv_baseline && state.hrv < state.hrv_baseline - state.hrv_sd)
    reasons.push(`HRV ${Math.round(state.hrv)}ms is more than 1 SD below your 30-day ${Math.round(state.hrv_baseline)}ms.`);
  // 5+ mornings is no longer "back off today" -- it is a rest week.
  const deload = state.hrv_low_streak >= 5;
  if (deload) {
    reasons.push(`HRV has been below its band ${state.hrv_low_streak} mornings. ` +
                 `At 5+ the answer is a recovery week, not a lighter day: ` +
                 `volume down 20-30%, intensity low, mobility up.`);
  }
  if (state.hrv_low_streak >= tun.hrv_low_streak_downgrade) {
    reasons.push(`HRV has been below its band ${state.hrv_low_streak} mornings running — that is a deload signal, not a bad night.`);
    level = down(level);
  }

  // Resting HR against its own baseline: +5 mild, +10 skip hard sessions,
  // +15 do not train. One of the earliest warning signs of illness incubating
  // or training stress accumulating.
  const rhrUp = state.rhr_baseline ? state.rhr - state.rhr_baseline : 0;
  if (rhrUp >= 15) {
    reasons.push(`Resting HR is ${rhrUp.toFixed(0)} bpm over baseline — that is ` +
                 `the "do not train" threshold, and often illness incubating.`);
    level = "red";
  } else if (rhrUp >= 10) {
    reasons.push(`Resting HR is ${rhrUp.toFixed(0)} bpm over baseline — skip anything hard.`);
    level = down(level);
  } else if (rhrUp >= 5) {
    reasons.push(`Resting HR is ${rhrUp.toFixed(0)} bpm over baseline — mild system stress.`);
  }

  const tw = state.run_minutes_this_week, lw = state.run_minutes_last_week;
  const overCap = lw > 0 && tw >= lw * (1 + tun.max_weekly_mileage_growth);
  if (overCap)
    reasons.push(`Running ${tw} min this week vs ${lw} last — already at the ${Math.round(tun.max_weekly_mileage_growth * 100)}% cap.`);

  let call: string, detail: string;
  const longMi = plan.long_run_this_week_mi;
  const tomorrowIsLongRun =
    template[DOW[(DOW.indexOf(state.dow as any) + 1) % 7]]?.[0] === "long run";
  const lift = liftOf(planned);
  const activity = personal.activities.find((a) => a.sport === planned);
  const longRunDow = DOW.find((d) => template[d]?.[0] === "long run");

  // What a kind of day costs this athlete: their own learned number where it
  // exists, the default otherwise. Text says which.
  const learned = (kind: string, fallback: number) =>
    personal.sessionCosts[kind] ?? { value: fallback, n: 0, source: "default" as const };
  const costText = (c: ActivityCost) =>
    `about ${Math.abs(c.value).toFixed(c.n >= MIN_MEASURED ? 1 : 0)} recovery points` +
    (c.source === "measured" ? ` (measured from ${c.n} of your days)` : "");
  const runCost = learned("run:easy", Math.max(tun.cost_running, -6));
  const liftCost = lift ? learned(`lift:${lift === "upper" || lift === "full body" ? "push" : lift}`,
                                  lift === "legs" ? tun.cost_legs_quad : tun.cost_lift_upper) : null;

  if (level === "red") {
    call = planned === "rest" ? "Rest, as planned." : "Rest today.";
    detail = "Walk if you want to move. Nothing that adds strain.";
  } else if (planned === "rest") {
    call = "Rest day."; detail = "Nothing scheduled. A walk is free.";
  } else if (activity) {
    const cost = personal.activityCosts[activity.sport]
      ?? { value: INTENSITY_COST[activity.intensity], n: 0, source: "default" as const };
    const when = Number(activity.time?.slice(0, 2)) >= 15 ? "tonight" : "today";
    call = level === "green"
      ? `${activity.label} ${when}.`
      : `${activity.label} ${when} — ${activity.intensity === "hard" ? "pace yourself" : "keep it easy"}.`;
    const points = Math.abs(cost.value);
    detail = (cost.value >= -0.5
        ? "It barely moves your recovery"
        : `Costs about ${points.toFixed(0)} recovery points` +
          (points < Math.abs(tun.cost_running) ? ", less than a hard run" : ""))
      + (cost.source === "measured" ? ` (measured from ${cost.n} of your sessions)` : "")
      + ". No lift today.";
    if (tomorrowIsLongRun && activity.intensity !== "easy")
      detail += " Long run tomorrow, so ease off late in the session.";
  } else if (planned === "long run") {
    let mi = level === "green" ? longMi : Math.round(longMi * 0.75 * 10) / 10;
    if (overCap) mi = Math.round(mi * 0.85 * 10) / 10;
    call = `Long run — ${mi} miles, easy.`;
    detail = `Stay under ${z2} bpm the whole way. ` + (plan.has_race
      ? `Week ${plan.weeks_out} out; this is the session the race is built on.`
      : "The longest easy session of your week.");
  } else if (hasEasyRun(planned) && overCap && level !== "green") {
    call = lift ? `${LIFT_LABEL[lift]} only.` : "Rest the legs today.";
    detail = `You are already at this week's running cap (${tw} min vs ${lw} last week). Sudden volume jumps are where running injuries come from; the build holds.`;
  } else if (lift && liftCost && hasEasyRun(planned) && level !== "green") {
    // Amber: one of the two goes, and it is whichever costs this athlete more.
    if (runCost.value <= liftCost.value) {
      call = `${LIFT_LABEL[lift]} only. Skip the run.`;
      detail = `Amber, so the run goes: it costs you ${costText(runCost)}, the lift ${costText(liftCost)}.`;
    } else {
      call = `Easy run only. Skip the lift.`;
      detail = `Amber, so the lift goes: it costs you ${costText(liftCost)}, the run ${costText(runCost)}. Under ${z2} bpm.`;
    }
  } else if (hasEasyRun(planned)) {
    call = level === "green" ? "Easy run, 25–30 minutes." : "Easy run, 20 minutes, or skip it.";
    detail = `Under ${z2} bpm. An easy run costs you ${costText(runCost)}` +
      (runCost.source === "measured" ? "." : " — zone 2 is the experiment.");
    if (lift) detail += lift === "pull"
      ? " Pull lift too: rows, and add a vertical pull."
      : ` ${LIFT_LABEL[lift]} too.`;
  } else if (planned === "legs") {
    call = "Leg day.";
    detail = level === "green"
      ? `Leg day costs you ${costText(learned("lift:legs", tun.cost_legs_quad))}.${longRunDow ? ` ${DAY_NAME[longRunDow]} is far enough away.` : ""}`
      : "Amber recovery. Same session, no load increase.";
  } else if (lift && lift !== "push") {
    call = `${LIFT_LABEL[lift]}.`;
    detail = personal.cues[lift] ?? (lift === "full body"
      ? "One session across the whole body; what leads rotates each time."
      : `Upper body only — costs you ${costText(liftCost!)}.`);
    if (level !== "green") detail = `Hold at current weights. ${detail}`;
  } else {
    call = "Push lift.";
    detail = personal.cues.push ?? `Upper body only — costs you ${costText(learned("lift:push", tun.cost_lift_upper))}.`;
    if (level !== "green") detail = `Hold at current weights. ${detail}`;
  }

  return { level, call, detail, planned, why_today: why, reasons,
           zone2_ceiling: z2, deload_advised: deload };
}

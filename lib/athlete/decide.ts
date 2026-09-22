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
   *  own mornings; filled in with fitCosts(). Keys are session kinds:
   *  "lift:legs", "run:zone2", "sport:lacrosse", "lift:pull+run:zone2". */
  sessionCosts: Record<string, ActivityCost>;
  /** Where green and red actually sit for this athlete; filled in with
   *  recoveryBands(). */
  bands: Bands;
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
    bands: { green: DEFAULT_TUNABLES.recovery_green, red: DEFAULT_TUNABLES.recovery_red,
             n: 0, source: "default", shift: 0 },
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

/** Minutes past local midnight. */
function localMinutes(ts: string, offset?: string | null): number {
  const local = new Date(Date.parse(ts) + offsetMin(offset) * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function offsetMin(offset?: string | null): number {
  let off = offset ?? "+00:00";
  if (off.length < 6 || !"+-".includes(off[0])) off = "+00:00";
  const sign = off[0] === "+" ? 1 : -1;
  return sign * (parseInt(off.slice(1, 3)) * 60 + parseInt(off.slice(4, 6)));
}

/** Hours actually asleep in one WHOOP sleep. */
function asleepHours(s: Rec): number {
  const st = s.score?.stage_summary ?? {};
  return ((st.total_in_bed_time_milli ?? 0) - (st.total_awake_time_milli ?? 0)) / 3.6e6;
}

/** Everything slept in the night that ended on `day`: every scored sleep,
 *  nap segments included, that ended that morning. A night broken by being
 *  awake for a while is two WHOOP sleeps, and both count. */
function nightHours(w: Rec, day: string): number {
  let h = 0;
  for (const s of w.sleep ?? [])
    if (s.score && localDay(s.end, s.timezone_offset) === day && localMinutes(s.end, s.timezone_offset) < 13 * 60)
      h += asleepHours(s);
  return Math.round(h * 10) / 10;
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : 0;
};

/**
 * Whether this morning's recovery is probably premature: the night is well
 * short of the athlete's usual and they could still be in it. That is what
 * waking for a while and going back to sleep looks like, and WHOOP scores
 * recovery at the first wake, so the decision would be made on half a night.
 *
 * It waits until the night stops looking short -- the next poll sees the
 * fuller sleep and the real recovery -- or until the cutoff, four hours past
 * their usual wake and never past one in the afternoon. Anything WHOOP
 * records them doing today ends the wait immediately: someone who is up and
 * training is up, whatever the night was. Late beats wrong here, because a
 * decision built on four hours when they slept eight is the wrong session for
 * the whole day.
 *
 * `notBefore` is the athlete's own floor in local minutes, if they set one.
 */
export function prematureMorning(w: Rec, nowMs = Date.now(), notBefore?: number | null) {
  const mains = (w.sleep ?? []).filter((s: Rec) => s.score && !s.nap)
    .sort((a: Rec, b: Rec) => String(b.end).localeCompare(String(a.end)));
  const last = mains[0];
  if (!last) return null;
  const off = last.timezone_offset;
  const today = localDay(last.end, off);
  const history = mains.filter((s: Rec) => localDay(s.end, s.timezone_offset) < today).slice(0, 30);
  if (history.length < 10) return null;
  const usualWake = median(history.map((s: Rec) => localMinutes(s.end, s.timezone_offset)));
  const usualHours = median([...new Set<string>(history.map((s: Rec) => localDay(s.end, s.timezone_offset)))]
    .map((d) => nightHours(w, d)).filter((h) => h > 0));
  const slept = nightHours(w, today);
  const woke = localMinutes(last.end, off);
  const now = localMinutes(new Date(nowMs).toISOString(), off);
  const nowDay = localDay(new Date(nowMs).toISOString(), off);
  const clock = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, "0")}`;
  // How long a short morning may be held: four hours past the usual wake,
  // never past one in the afternoon, and at least an hour whatever the usual.
  const cutoff = Math.min(Math.max(usualWake + 240, usualWake + 60), 13 * 60);
  const short = slept < 0.85 * usualHours;
  // Waking an hour or more later than usual and still short means the night
  // is over and it was a bad one. Waiting cannot add to it.
  const couldStillBeAsleep = woke <= usualWake + 60;
  // Anything recorded today: they are up, so there is nothing to wait for.
  const upAndAbout = (w.workouts ?? []).some(
    (x: Rec) => localDay(x.start, x.timezone_offset) === today);
  const wait = nowDay === today && short && couldStillBeAsleep && !upAndAbout && now < cutoff;
  // The athlete's own floor is separate: no decision before this time, however
  // the night went.
  const early = nowDay === today && notBefore != null && now < notBefore;
  const usual = Math.round(usualHours * 10) / 10;
  return {
    wait: wait || early,
    slept_h: slept,
    usual_h: usual,
    woke: clock(woke),
    usual_wake: clock(usualWake),
    cutoff: clock(cutoff),
    reason: wait
      ? `short night (${slept}h against your usual ${usual}h) that ended at ${clock(woke)}; holding in case you went back to sleep, and sending by ${clock(cutoff)} either way`
      : early
        ? `you asked for nothing before ${clock(notBefore!)}`
        : null,
  };
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
    // Core work is not one of the lift days the week rotates through, so a
    // day of it does not count as the lift having been done.
    if (k === "core") continue;
    out[d] = k.startsWith("legs") ? "legs" : k;
  }
  return out;
}

/** A zone 2 run of this length or more is the long run. */
const LONG_RUN_MIN = 45;

/**
 * Which bucket a run falls in, for this athlete: zone 2, long (zone 2 and
 * long enough), or hard. By average heart rate against their own zone 2
 * ceiling when they have set one; otherwise by WHOOP's own heart-rate zones
 * for them, which are already scaled to their max. Duration never decides
 * intensity. A run with no heart-rate data counts as hard, the safe guess.
 */
export function runKind(x: Rec, zone2: number | null | undefined): string {
  const min = (Date.parse(x.end) - Date.parse(x.start)) / 60_000;
  const sc = x.score ?? {};
  let easy: boolean | null = null;
  if (zone2 && sc.average_heart_rate) easy = sc.average_heart_rate <= zone2 + 3;
  else {
    const z = sc.zone_durations ?? sc.zone_duration;
    if (z) {
      const tot = Object.values(z as Record<string, number>).reduce((a, b) => a + (b ?? 0), 0);
      if (tot > 0)
        easy = ((z.zone_zero_milli ?? 0) + (z.zone_one_milli ?? 0) + (z.zone_two_milli ?? 0)) / tot >= 0.7;
    }
  }
  if (easy !== true) return "run:hard";
  return min >= LONG_RUN_MIN ? "run:long" : "run:zone2";
}

/**
 * What the athlete did on each day the WHOOP history covers: lifts from their
 * log, runs and sports from WHOOP, nothing for a rest day. These are the
 * things the plan schedules, so they are the things worth knowing the price
 * of. A WHOOP "weightlifting" entry on a day with a logged lift is that lift,
 * recorded twice, not a second session.
 */
export function dayKinds(w: Rec, sets: LoggedSet[], zone2?: number | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of Object.keys(recoveryByDay(w))) out[d] = [];
  for (const x of w.workouts ?? []) {
    const sport = String(x.sport_name ?? "");
    if (!sport || BACKGROUND.has(sport)) continue;
    const d = localDay(x.start, x.timezone_offset);
    if (!(d in out)) continue;
    out[d].push(sport === "running" ? runKind(x, zone2) : `sport:${sport}`);
  }
  for (const [d, kind] of Object.entries(liftKindByDay(sets)))
    if (d in out) out[d].push(`lift:${kind}`);
  for (const d of Object.keys(out))
    if (out[d].some((k) => k.startsWith("lift:")))
      out[d] = out[d].filter((k) => k !== "sport:weightlifting" && k !== "sport:functional_fitness");
  return out;
}

/** One morning the model learns from: what the day held, the recovery it
 *  started from, the recovery it led to, and the night's sleep in between. */
export type DayRow = {
  kind: string;
  rec: number;
  next: number;
  /** Sleep performance the next morning, 0-100, when WHOOP scored it. */
  sleep_perf: number | null;
  /** Hours actually asleep that night. */
  sleep_h: number | null;
};

/**
 * The rows the model fits on. A day with two things on it is the pair
 * ("lift:pull+run:zone2"), never either alone, so a run and a lift are not
 * blamed for each other. A day with nothing is "rest": the baseline every
 * other kind is measured against.
 */
export function learnRows(w: Rec, kinds: Record<string, string[]>): Record<string, DayRow> {
  const rec = recoveryByDay(w);
  const night: Record<string, { sleep_perf: number | null; sleep_h: number | null }> = {};
  for (const sl of w.sleep ?? []) {
    if (!sl.score || sl.nap) continue;
    const st = sl.score.stage_summary ?? {};
    const asleep = st.total_in_bed_time_milli != null
      ? ((st.total_in_bed_time_milli ?? 0) - (st.total_awake_time_milli ?? 0)) / 3.6e6 : null;
    night[localDay(sl.end, sl.timezone_offset)] = {
      sleep_perf: sl.score.sleep_performance_percentage ?? null,
      sleep_h: asleep != null ? Math.round(asleep * 10) / 10 : null,
    };
  }
  const out: Record<string, DayRow> = {};
  for (const [d, ks] of Object.entries(kinds)) {
    const nd = shift(d, 1);
    if (rec[d] == null || rec[nd] == null) continue;
    const n = night[nd] ?? { sleep_perf: null, sleep_h: null };
    out[d] = { kind: [...new Set(ks)].sort().join("+") || "rest", rec: rec[d], next: rec[nd], ...n };
  }
  return out;
}

/** Solves A x = b for a small symmetric system; null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-9) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Days of the athlete's own history a default is worth. Four means a single
 *  bad morning barely moves the number; twenty measured days all but replace
 *  the default. */
const PRIOR_WEIGHT = 4;

/** The default cost of a kind of day against a rest day, before the
 *  athlete's own history says otherwise. Pairs add. Sports take the intensity
 *  the athlete gave them. */
export function priorCost(kind: string, tun: Tunables, activities: Activity[]): number {
  return kind.split("+").reduce((sum, k) => {
    if (k === "rest") return sum;
    if (k === "run:zone2") return sum - 4;
    if (k === "run:long") return sum - 7;
    if (k === "run:hard") return sum + tun.cost_running;
    if (k === "lift:legs") return sum + tun.cost_legs_quad - 2;
    if (k.startsWith("lift:")) return sum + tun.cost_lift_upper - 2;
    if (k.startsWith("sport:")) {
      const a = activities.find((x) => `sport:${x.sport}` === k);
      return sum + (a ? INTENSITY_COST[a.intensity] : -3) - 2;
    }
    return sum;
  }, 0);
}

export type LearnedCost = ActivityCost & { se?: number | null };

/**
 * What every kind of day costs this athlete, fit all at once: next morning's
 * recovery on that morning's recovery, the night's sleep in between, and one
 * term per kind of day, with a rest day as the baseline. So a bad night's
 * sleep is charged to the sleep, not to whatever was trained, and each cost
 * reads as "against a rest day, sleep held equal". Every cost is blended
 * toward its default until the athlete's own mornings outweigh it, and
 * carries a standard error. An explicit `cost_<kind>` in the profile's
 * tunables wins outright.
 */
export function fitCosts(rows: Record<string, DayRow>, tun: Tunables, activities: Activity[]):
    Record<string, LearnedCost> {
  const data = Object.values(rows);
  const counts: Record<string, number> = {};
  for (const r of data) if (r.kind !== "rest") counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  const kinds = Object.keys(counts).sort();
  const tunables = tun as unknown as Record<string, unknown>;

  // Fill the sleep terms with their means where WHOOP has no score, so a
  // missing night costs a row nothing but its own information.
  const sp = data.map((r) => r.sleep_perf).filter((v): v is number => v != null);
  const sh = data.map((r) => r.sleep_h).filter((v): v is number => v != null);
  const mSp = sp.length ? mean(sp) : 0, mSh = sh.length ? mean(sh) : 0;
  const cols = 3 + kinds.length;
  const X = data.map((r) => {
    const row = new Array(cols).fill(0);
    row[0] = 1; row[1] = r.rec; row[2] = (r.sleep_perf ?? mSp) - mSp;
    const k = kinds.indexOf(r.kind); if (k >= 0) row[3 + k] = 1;
    return row;
  });
  void mSh; void sh;
  const y = data.map((r) => r.next);

  let beta: number[] | null = null, se: number[] | null = null;
  if (data.length >= 20 + kinds.length) {
    const XtX = Array.from({ length: cols }, () => new Array(cols).fill(0));
    const Xty = new Array(cols).fill(0);
    for (let i = 0; i < X.length; i++)
      for (let a = 0; a < cols; a++) {
        Xty[a] += X[i][a] * y[i];
        for (let b = 0; b < cols; b++) XtX[a][b] += X[i][a] * X[i][b];
      }
    for (let a = 0; a < cols; a++) XtX[a][a] += 1e-6;
    beta = solve(XtX, Xty);
    if (beta) {
      const b = beta;
      const rss = X.reduce((acc, row, i) => acc + (y[i] - row.reduce((s2, v, j) => s2 + v * b[j], 0)) ** 2, 0);
      const sigma2 = rss / Math.max(1, X.length - cols);
      se = new Array(cols).fill(null);
      for (let j = 0; j < cols; j++) {
        const e = new Array(cols).fill(0); e[j] = 1;
        const col = solve(XtX, e);
        if (col) se[j] = Math.sqrt(Math.max(0, sigma2 * col[j]));
      }
    }
  }

  const out: Record<string, LearnedCost> = {};
  for (const kind of kinds) {
    const n = counts[kind];
    const override = tunables[`cost_${kind.replace(/[^a-z0-9]+/g, "_")}`];
    if (typeof override === "number") { out[kind] = { value: override, n, source: "profile", se: null }; continue; }
    const prior = priorCost(kind, tun, activities);
    const j = 3 + kinds.indexOf(kind);
    const coef = beta ? beta[j] : prior;
    const value = Math.round(((n * coef + PRIOR_WEIGHT * prior) / (n + PRIOR_WEIGHT)) * 10) / 10;
    out[kind] = {
      value, n,
      source: beta && n >= MIN_MEASURED ? "measured" : "default",
      se: se?.[j] != null ? Math.round(se[j] * 10) / 10 : null,
    };
  }
  return out;
}

/** "lift:pull+run:zone2" -> "Pull lift + zone 2 run". */
export function kindLabel(kind: string): string {
  return kind.split("+").map((k) => {
    if (k === "rest") return "Rest day";
    if (k === "run:zone2") return "zone 2 run";
    if (k === "run:long") return "long run";
    if (k === "run:hard") return "hard run";
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

  // Each night belongs to the morning it ended on; the longest main sleep
  // carries its debt and performance.
  const sleep: Record<string, Rec> = {};
  const longest: Record<string, number> = {};
  for (const s of w.sleep) {
    if (!s.score || s.nap) continue;
    const d = localDay(s.end, s.timezone_offset);
    const h = asleepHours(s);
    if (!(d in sleep) || h > longest[d]) { sleep[d] = s.score; longest[d] = h; }
  }

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
  const need = sl.sleep_needed ?? {};
  // Every segment of the night, so waking for a while does not halve it.
  const sleptH = nightHours(w, today);

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

/** Mon-first day of the week for a date. */
const dowOf = (day: string) => DOW[(new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7];

/**
 * A lift that was scheduled and did not happen comes forward to the next lift
 * day, instead of the week carrying on and the session being lost. Rest on
 * Saturday when push was due means push today, and legs waits its turn.
 *
 * Only a day with nothing at all recorded counts as missed: a day with a run
 * or a match on it was traded, not skipped, and a lift made up since is not
 * owed twice. Days WHOOP never scored are left alone rather than guessed at.
 * It looks back four days, so a session missed last week stays missed.
 */
export function carryForward(
  template: Record<string, Slot>,
  kinds: Record<string, string[]>,
  today: string,
  lookback = 4,
): { slot: Slot; from: string; kind: string; reason: string } | null {
  const todaySlot = template[dowOf(today)];
  const todayLift = liftOf(todaySlot?.[0]);
  if (!todayLift) return null;

  for (let i = lookback; i >= 1; i--) {
    const day = shift(today, -i);
    if (!(day in kinds) || kinds[day].length) continue;
    const lift = liftOf(template[dowOf(day)]?.[0]);
    if (!lift || lift === todayLift) continue;
    // Done since on some other day: the athlete already moved it themselves.
    let madeUp = false;
    for (let d = shift(day, 1); d < today; d = shift(d, 1))
      if ((kinds[d] ?? []).includes(`lift:${lift}`)) madeUp = true;
    if (madeUp) continue;
    const withRun = todaySlot[0].endsWith("+run") ? "+run" : "";
    const reason = `Carried over from ${DAY_NAME[dowOf(day)]}, when nothing was trained.`;
    return {
      slot: [`${lift}${withRun}`, `${LIFT_LABEL[lift]}, moved here from ${DAY_NAME[dowOf(day)]}.`],
      from: day,
      kind: lift,
      reason,
    };
  }
  return null;
}

/* ---------------------------------------------------------------- lifting */

export function classifyDay(vol: Record<string, number>): string {
  const g = (k: string) => vol[k] ?? 0;
  const low = LOWER.reduce((a, b) => a + g(b), 0);
  const up = ["chest", "shoulders", "triceps", "back", "biceps", "forearms"]
    .reduce((a, b) => a + g(b), 0);
  // Abs and nothing else is a core session, not a lift day. Without this it
  // falls through the push/pull test with nothing on either side and comes
  // out "pull", which then stands in as the last pull session and gets
  // prescribed back as one.
  if (up + low < 2 && g("abdominals") > 0) return "core";
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

/** How long an addition waits before it is suggested again, having been
 *  suggested and not done. A nudge every morning is not a nudge. */
export const ADD_REPEAT_DAYS = 7;

/** Done inside this many days counts as taken up, so the addition retires and
 *  the exercise carries on in the session it was added to. */
const ADD_TAKEN_UP_DAYS = 60;

const sameExercise = (a: string, b: string) => {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(\w+?)s\b/g, "$1").replace(/\s+/g, " ").trim();
  const [x, y] = [norm(a), norm(b)];
  return Boolean(x && y) && (x === y || x.includes(y) || y.includes(x));
};

/** Additions that are protocols or whole blocks rather than one exercise to
 *  take up: these are not retired by doing them once. */
const STANDING_ADD = /slow breathing|ab circuit|core|mobility|isometric/i;

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
  if (/calf|calves|\btib|shin|\babs?\b|abdominal|crunch|plank|torso|\bcore\b|oblique|dead bug|bird dog|hollow|sit ?ups?|leg raise|hanging knee|toe touch|v to ext|v-?ups?|ab workout/.test(n)
      || /calves|abdominal|oblique/.test(m)) return 3;
  if (/tricep|bicep|curl|extension|lateral raise|front raise|rear delt|reverse fly|\bfly|flye|pec deck|face pull|kickback|pushdown|pullover|shrug|rotation|inner thigh|outer thigh|adduct|abduct/.test(n)) return 2;
  if (/bulgarian|split squat|lunge|step ?up|\brdl|romanian|good morning|single.?leg|pistol|nordic|hip thrust|glute bridge|\brow|lat pull|pull ?down|pull ?up|chin ?up|\bdip/.test(n)) return 1;
  if (/squat|hack|leg press|deadlift|bench|press|clean|snatch/.test(n)) return 0;
  return 1.5;
}

/** A session's lifts in the order to do them, and how: the compounds as
 *  straight sets, the small stuff as one mini circuit. */
export type SessionBlock = { title: string | null; note: string | null; items: string[] };

/** Core movements the plan adds when the athlete's own log has fewer than
 *  three: one anti-extension, one anti-rotation, one hold. */
const CORE_DEFAULTS: [RegExp, string][] = [
  [/plank/, "Plank — 3 x 45 s"],
  [/dead bug/, "Dead bug — 3 x 10 each side"],
  [/pallof|anti.?rotation/, "Pallof press — 3 x 10 each side"],
];

/** One movement of a core routine, as the athlete does it. */
function coreLine(e: LoggedSet & { total: number }): string {
  const name = e.exercise.trim();
  const times = e.total > 1 ? `${e.total} x ` : "";
  if (e.pin && !/from (top|bottom)/i.test(e.pin)) return `${name} — ${times}${e.pin}`;
  if (/plank|hold/i.test(name) && e.reps == null) return `${name} — 45 sec`;
  if (e.weight == null) return `${name} — ${times}${e.reps ?? "–"} reps`;
  return `${name} — ${Math.max(e.total, 3)} x ${e.reps ?? "–"} @ ${e.weight}`;
}

/**
 * The athlete's own core routine: the most recent day their log shows a real
 * core session (three or more movements), as they did it, or failing that
 * their most recent core work. Filled to three movements with the defaults
 * only when the log has fewer, so "core" is never just a word.
 */
export function coreCircuit(sets: LoggedSet[], today: string,
                            muscleOf?: (name: string) => string | null | undefined): string[] {
  void today;
  const isCore = (name: string, muscle?: string | null) =>
    exerciseTier(name, muscle) === 3 && !/calf|calves|\btib|shin/.test(name.toLowerCase());
  const byDay: Record<string, LoggedSet[]> = {};
  for (const r of sets) {
    const k = r.exercise.trim();
    // The routine's header line records that it was done, not a movement.
    if (/^ab workout$/i.test(k) || !isCore(k, muscleOf?.(k))) continue;
    (byDay[r.day] ??= []).push(r);
  }
  const days = Object.keys(byDay).sort().reverse();
  const pick = days.find((d) => new Set(byDay[d].map((r) => r.exercise.trim())).size >= 3) ?? days[0];
  const own: string[] = [];
  if (pick) {
    const seen: Record<string, LoggedSet & { total: number }> = {};
    for (const r of byDay[pick]) {
      const k = r.exercise.trim();
      if (!seen[k]) seen[k] = { ...r, total: r.sets }; else seen[k].total += r.sets;
    }
    own.push(...Object.values(seen).map(coreLine));
  }
  const items = [...own];
  for (const [re, line] of CORE_DEFAULTS) {
    if (items.length >= 3) break;
    if (!own.some((o) => re.test(o.toLowerCase()))) items.push(line);
  }
  return items;
}

export function prescribe(sets: LoggedSet[], planned: string, level: string,
                          z2: number, longMi: number, opts: {
                            hrvStreak?: number; intervalsReady?: boolean;
                            easyMinutes?: number; personal?: Personal;
                            defaultSets?: number;
                            /** How much of the session to do, 0-1, from where
                             *  the morning sits between this athlete's lines.
                             *  Without it, one flat amber amount. */
                            scale?: number;
                            /** Primary muscle of a logged name, from the athlete's alias map. */
                            muscleOf?: (name: string) => string | null | undefined;
                            /** The athlete's local date, for "recent". */
                            today?: string;
                            /** Additions already suggested in the last
                             *  ADD_REPEAT_DAYS days, so one is not asked for
                             *  again every morning. */
                            recentAdds?: string[];
                          } = {}) {
  const personal = opts.personal ?? personalFrom({});
  const scale = level === "green" ? 1 : opts.scale ?? 0.8;
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
      // Below the green line the sets come down with the number rather than
      // by a flat amount, but never below two: one set is not a stimulus.
      const full = Math.max(e.sets, opts.defaultSets ?? DEFAULT_TUNABLES.default_sets);
      const nSets = scale === 1 ? full : Math.max(2, Math.round(full * scale));
      (tier >= 2 ? circuit : straight).push(
        `${e.exercise} — ${nSets} x ${e.reps ?? "–"} @ ${load}` + (bump ? `  ↑ go to ${bump}` : ""));
    }
    // One lone accessory is not a circuit; it just goes on the end.
    if (circuit.length === 1) straight.push(circuit.pop()!);
    if (straight.length)
      blocks.push({ title: "Straight sets", items: straight,
                    note: "All sets of one lift before the next. Rest 2–3 min between sets on the compounds." });
    if (circuit.length)
      // Only a circuit when it is the small stuff after the main lifts. On
      // its own it is the session, and the sets beside each movement say how
      // it is done.
      blocks.push(straight.length
        ? { title: "Mini circuit", items: circuit,
            note: "One set of each, then round again, until each has the sets beside it. About a minute between rounds." }
        : { title: null, note: null, items: circuit });
    items.push(...straight, ...circuit);
  }

  if (planned === "run" || (planned.endsWith("+run") && level === "green")) {
    const base = opts.easyMinutes ?? 25;
    items.push(`Easy run — ${Math.round(base * scale)} min, under ${z2} bpm`);
  }
  if (planned === "long run") {
    const mi = Math.round(longMi * scale * 10) / 10;
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
  let add: [string, string, string] | null | undefined = personal.additions[planned]
    ?? focusAddition(personal.focusMuscles, planned, lift)
    ?? ADDITIONS[planned] ?? ADDITIONS[lift ?? ""];
  if (add && !STANDING_ADD.test(add[0])) {
    // Taken up already: it belongs in the session now, not in a box at the
    // bottom. The session is built from the last day of this kind, so once it
    // has been done on one it comes back on its own. Recently, though: an
    // exercise last done two years ago is the reason an addition exists.
    const since = opts.today ? shift(opts.today, -ADD_TAKEN_UP_DAYS) : "0000-00-00";
    if (sets.some((r) => r.day >= since && sameExercise(r.exercise, add![0]))) add = null;
    // Already in today's session, from that same history.
    else if (items.some((i) => sameExercise(i.split("—")[0], add![0]))) add = null;
    // Suggested in the last few days and not taken up: leave it be rather
    // than asking again every morning, or reaching for something new.
    else if ((opts.recentAdds ?? []).length) add = null;
  }
  // When HRV is the thing that is off, the breathing protocol outranks whatever
  // else was scheduled: after one low morning when HRV is the athlete's goal,
  // after two otherwise.
  if ((opts.hrvStreak ?? 0) >= (personal.goals.includes("hrv") ? 1 : 2))
    add = ["Slow breathing", "10 min at 6 breaths/min",
           "HRV has been below its band. Slow breathing is the best-evidenced " +
           "way to raise RMSSD: 5-15 ms over 4-6 weeks."];

  if (level === "red")
    return { items: ["Walk if you want to move."], blocks: [], source_date: null, add: null, hold: true };

  // Whatever is not a lift -- the run, the sport, strides -- is its own block,
  // and it comes before the core work below: the run is the session, core is
  // what finishes the day.
  const rest = items.filter((i) => !blocks.some((b) => b.items.includes(i)));
  if (rest.length) blocks.push({ title: blocks.length ? "Also today" : null, note: null, items: rest });

  // "Ab circuit" becomes the athlete's own core exercises, at their loads,
  // as a block of the session rather than a word in the addition.
  if (add && /ab circuit|core/i.test(add[0])) {
    const core = coreCircuit(sets, opts.today ?? new Date().toISOString().slice(0, 10), opts.muscleOf);
    if (core.length) {
      const own = core.filter((c) => !CORE_DEFAULTS.some(([, line]) => line === c)).length;
      // A bodyweight routine is done straight through, once; machine work
      // goes round three times.
      const routine = core.every((c) => !/@ \d/.test(c));
      add = ["Core work",
             routine ? `${core.length} movements, about 10 min` : `${core.length} movements, 3 rounds, about 10 min`,
             add[2] + (own ? " Your own routine, as you last did it." : "")];
      // Whether it is one pass or several is the sets beside each movement,
      // not the word "circuit": saying "straight through, once" next to
      // "3 x 50" tells the athlete two different things.
      const rounds = core.some((c) => /\b\d+ x /.test(c));
      blocks.push({ title: "Core work", items: core,
                    note: rounds
                      ? "One at a time, all the sets beside it, then on to the next. About 10 minutes."
                      : "Straight through, once. About 10 minutes." });
      items.push(...core);
    }
  }

  return {
    items,
    blocks,
    source_date: source,
    add: add ? { name: add[0], dose: add[1], why: add[2] } : null,
    hold: level !== "green",
  };
}

/* --------------------------------------------------------------- bands */

/** Where this athlete's green and red lines sit, and what put them there. */
export type Bands = {
  green: number;
  red: number;
  /** Mornings of their own recovery behind the lines. */
  n: number;
  source: "measured" | "default" | "profile";
  /** Points the lines moved because of how this athlete responds to training
   *  started low. Positive means they need more recovery in hand than their
   *  own spread alone would suggest. */
  shift: number;
};

/** Mornings before an athlete's own spread outweighs the default lines. */
const BAND_PRIOR = 20;
/** However unusual someone's WHOOP is, a line does not leave this range. */
const GREEN_RANGE: [number, number] = [55, 78];
const RED_RANGE: [number, number] = [22, 45];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function percentile(xs: number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[clamp(Math.round((sorted.length - 1) * p), 0, sorted.length - 1)];
}

/**
 * How much worse a training day goes for this athlete when they started it
 * below their own middle. Mean reversion comes out first -- a low morning is
 * followed by a better one whatever happens, which is exactly what makes raw
 * numbers misleading here -- so what is left is the part the training is
 * answerable for. Null until there are enough days on both sides.
 */
export function bandShift(rows: Record<string, DayRow>):
    { shift: number; low: number; high: number; n: number } | null {
  const rec: Record<string, number> = {};
  for (const [d, r] of Object.entries(rows)) rec[d] = r.rec;
  const predict = meanReversion(rec);
  if (!predict) return null;
  const trained = Object.values(rows).filter((r) => r.kind !== "rest");
  if (trained.length < 2 * MIN_MEASURED) return null;
  const mid = percentile(trained.map((r) => r.rec), 0.5);
  const low: number[] = [], high: number[] = [];
  for (const r of trained) (r.rec < mid ? low : high).push(r.next - predict(r.rec));
  if (low.length < MIN_MEASURED || high.length < MIN_MEASURED) return null;
  // Positive: training when already low costs this athlete more than training
  // when fresh does. Half of it, because one gap is not a law.
  const diff = mean(high) - mean(low);
  return { shift: clamp(diff / 2, -5, 6), low: mean(low), high: mean(high),
           n: low.length + high.length };
}

/**
 * This athlete's own lines. WHOOP's 67 and 34 are the same number for
 * everybody; these come from the athlete's own spread of mornings -- their
 * upper middle and their bottom sixth -- and then move by what a day started
 * low actually costs them. Blended toward the defaults until their own
 * history outweighs them, and clamped so no line lands somewhere unsafe.
 * A line pinned in the profile's tunables wins outright.
 */
export function recoveryBands(w: Rec, tun: Tunables,
                              rows?: Record<string, DayRow>,
                              pinned = false): Bands {
  const base: Bands = { green: tun.recovery_green, red: tun.recovery_red, n: 0,
                        source: pinned ? "profile" : "default", shift: 0 };
  if (pinned) return base;
  const hist = Object.values(recoveryByDay(w));
  if (hist.length < 10) return base;
  const weight = hist.length / (hist.length + BAND_PRIOR);
  const blend = (own: number, def: number) => own * weight + def * (1 - weight);
  const s = rows ? bandShift(rows) : null;
  const shift = s ? Math.round(s.shift * 10) / 10 : 0;
  return {
    green: Math.round(clamp(blend(percentile(hist, 0.55), tun.recovery_green) + shift, ...GREEN_RANGE)),
    red: Math.round(clamp(blend(percentile(hist, 0.15), tun.recovery_red) + shift, ...RED_RANGE)),
    n: hist.length,
    source: hist.length >= BAND_PRIOR ? "measured" : "default",
    shift,
  };
}

/** Where a morning sits between this athlete's lines: 0 at red, 1 at green. */
export function readinessFraction(rec: number, b: Bands): number {
  if (b.green <= b.red) return rec >= b.green ? 1 : 0;
  return clamp((rec - b.red) / (b.green - b.red), 0, 1);
}

/**
 * How much of the planned session to do, straight off the number. Full above
 * the green line; between the lines it tapers with where the morning actually
 * sits, so 63% and 41% stop being the same day.
 */
export function volumeScale(rec: number, b: Bands): number {
  if (rec >= b.green) return 1;
  return Math.round((0.6 + 0.35 * readinessFraction(rec, b)) * 20) / 20;
}

/* ------------------------------------------------------------- decision */

export function decide(state: ReturnType<typeof buildState>,
                       plan: ReturnType<typeof racePlan>,
                       template: Record<string, Slot>, tun: Tunables, z2: number,
                       personal: Personal = personalFrom({})) {
  const rec = state.recovery;
  const [planned, why] = template[state.dow];
  // Not WHOOP's three colours: this athlete's own lines, learned from their
  // own spread of mornings and from what training on a low one costs them.
  const bands = personal.bands;
  let level = rec >= bands.green ? "green"
            : rec < bands.red ? "red" : "yellow";

  const reasons = [`Recovery ${Math.round(rec)}% (${level}).`
    + (bands.source === "measured"
        ? ` Your own lines sit at ${bands.green}% and ${bands.red}%, from ${bands.n} mornings`
          + (Math.abs(bands.shift) >= 0.5
              ? ` and how much a day started low costs you (${bands.shift > 0 ? "+" : ""}${bands.shift}).`
              : ".")
        : "")];
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

  // How much of the day survives, taken off the number itself rather than off
  // the colour: 71% and 45% are both amber, and they are not the same day.
  const scale = level === "red" ? 0 : volumeScale(rec, bands);
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
    (c.source === "measured" ? ` more than a rest day (from ${c.n} of your days)` : "");
  const runCost = learned("run:zone2", -4);
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
    let mi = Math.round(longMi * scale * 10) / 10;
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
    const mins = Math.max(10, Math.round((plan.easy_run_minutes ?? 25) * scale / 5) * 5);
    call = level === "green" ? `Easy run, ${mins}–${mins + 5} minutes.`
         : `Easy run, ${mins} minutes${scale <= 0.7 ? ", or skip it" : ""}.`;
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
           zone2_ceiling: z2, deload_advised: deload, scale, bands };
}

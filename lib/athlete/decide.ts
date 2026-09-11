/**
 * The decision engine, ported from whoop-dashboard/decide.py.
 *
 * Pure: WHOOP records + logged sets + config in, a decision out. No fetching,
 * no rendering, no database. Kept deliberately small so the Python version and
 * this one can be read side by side and seen to agree.
 */
import { musclesFor, bucket, LOWER } from "./muscles";

export const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type Tunables = {
  recovery_green: number;
  recovery_red: number;
  cost_running: number;
  cost_lacrosse: number;
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
  cost_lacrosse: -4.1,
  cost_legs_quad: -3.5,
  cost_lift_upper: -0.6,
  sleep_debt_downgrade: 2.0,
  hrv_low_streak_downgrade: 3,
  max_weekly_mileage_growth: 0.1,
  max_load_jump: 0.1,
  default_sets: 3,
};

export type LoggedSet = {
  day: string;
  exercise: string;
  weight: number | null;
  reps: number | null;
  sets: number;
  pin: string | null;
};

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

/* ------------------------------------------------------------------- plan */

export function racePlan(raceDate: string, today: string, recentLongMi: number,
                         longestEver: number) {
  const weeksOut = Math.max(
    0,
    Math.floor((Date.parse(raceDate) - Date.parse(today)) / (7 * DAY)),
  );
  const start = Math.max(recentLongMi, 3.0);
  const peak = 11.0;
  const build = Math.max(1, weeksOut - 3);
  const growthWeeks = Math.max(1, build - 1 - Math.floor((build - 1) / 4));
  const growth = (peak / start) ** (1 / growthWeeks);

  const schedule: number[] = [];
  let cur = start;
  for (let i = 0; i < build; i++) {
    const lastBuild = i === build - 1;
    if (i > 0 && i % 4 === 3 && !lastBuild) {
      schedule.push(Math.round(cur * 0.7 * 10) / 10);
    } else {
      if (i > 0) cur = Math.min(peak, cur * growth);
      schedule.push(Math.round((lastBuild ? peak : cur) * 10) / 10);
    }
  }
  schedule.push(
    Math.round(peak * 0.72 * 10) / 10,
    Math.round(peak * 0.45 * 10) / 10,
    13.1,
  );

  const idx = Math.max(0, schedule.length - weeksOut - 1);
  return {
    race_date: raceDate,
    weeks_out: weeksOut,
    long_run_this_week_mi: schedule[Math.min(idx, schedule.length - 1)],
    schedule_all: schedule,
    week_index: idx,
    longest_ever_mi: longestEver,
  };
}

export type Slot = [string, string];

export function weekTemplate(lacrosseDays: string[]): Record<string, Slot> {
  const t: Record<string, Slot> = {
    Sat: ["long run", "The long run. The session the race is built on."],
    Sun: ["rest", "Rest, or a walk."],
  };
  for (const d of lacrosseDays)
    if (d !== "Sat" && d !== "Sun")
      t[d] = ["lacrosse", "Lacrosse 6pm. Biggest session of your week."];

  const free = ["Mon", "Tue", "Wed", "Thu", "Fri"].filter((d) => !(d in t));
  const lifts: Slot[] = [
    ["legs", "Leg day. Furthest point from Saturday's long run."],
    ["pull", "Pull lift."],
    ["push", "Push lift. Legs stay fresh for Saturday."],
  ];

  let order: Slot[];
  if (free.length > lifts.length) {
    order = [lifts[0], ["run", "Easy zone 2 run, on its own day."], ...lifts.slice(1)];
  } else {
    order = lifts.map((s): Slot =>
      s[0] === "pull"
        ? ["pull+run", "Pull lift plus the easy run — the cheapest two to stack."]
        : s,
    );
  }
  free.forEach((d, i) => { if (order[i]) t[d] = order[i]; });
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
    for (const [m, w] of musclesFor(r.exercise)) {
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
  const best: Record<string, LoggedSet> = {};
  for (const r of sets) {
    if (r.day !== day) continue;
    const k = r.exercise.trim();
    if (!best[k] || (r.weight ?? 0) > (best[k].weight ?? 0)) best[k] = r;
  }
  return { day, exercises: Object.values(best) };
}

/** More weight only when it's been earned: same top set 3 sessions, green day. */
export function progression(sets: LoggedSet[], name: string, weight: number | null,
                            level: string, stale = 3): number | null {
  if (level !== "green" || !weight) return null;
  const low = name.trim().toLowerCase();
  if (["bench", "press", "shoulder", "lat raise"].some((k) => low.includes(k)))
    return null; // shoulder lifts stay manual, post-labrum

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
    for (const [m, w] of musclesFor(r.exercise)) {
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
    flags.push({ severity: "medium", title: "Calf volume is low and your shins flare",
      detail: `${per.calves ?? 0} sets/wk while running volume climbs.` });
  return { per_week: per, flags };
}

/* --------------------------------------------------------- prescription */

const ADDITIONS: Record<string, [string, string, string]> = {
  legs: ["Calf raises", "3 x 25",
    "Shins. Calves are 1.4 sets/wk while running volume climbs."],
  "pull+run": ["Lat pulldowns", "3 x 12 @ 100",
    "The vertical pull. You have not done one in 21 months."],
  pull: ["Lat pulldowns", "3 x 12 @ 100",
    "The vertical pull. You have not done one in 21 months."],
  push: ["Face pulls", "3 x 12",
    "Rear delts and scap control. Cheap insurance for the shoulder."],
  rest: ["Ab circuit", "10 min",
    "Core is 0.2 sets/wk. A rest day is where it fits."],
};

export function prescribe(sets: LoggedSet[], planned: string, level: string,
                          z2: number, longMi: number) {
  const items: string[] = [];
  let source: string | null = null;

  if (["push", "pull", "pull+run", "legs"].includes(planned)) {
    let kind: string;
    if (planned === "legs") {
      // Rotate: whichever leg variant is least recent.
      const opts = ["legs-quad", "legs-hip", "legs-posterior"]
        .map((k) => ({ k, d: lastSessionOf(sets, k).day ?? "0000-00-00" }))
        .sort((a, b) => a.d.localeCompare(b.d));
      kind = opts[0].k;
    } else {
      kind = planned === "push" ? "push" : "pull";
    }
    const { day, exercises } = lastSessionOf(sets, kind);
    source = day;
    for (const e of exercises) {
      const load = e.weight ? `${e.weight}` : e.pin ?? "bodyweight";
      const bump = progression(sets, e.exercise, e.weight, level);
      items.push(`${e.exercise} — ${e.sets} x ${e.reps ?? "–"} @ ${load}` +
                 (bump ? `  ↑ go to ${bump}` : ""));
    }
  }

  if (planned === "run" || (planned === "pull+run" && level === "green"))
    items.push(`Easy run — ${level === "green" ? 25 : 20} min, under ${z2} bpm`);
  if (planned === "long run") {
    const mi = level === "green" ? longMi : Math.round(longMi * 0.75 * 10) / 10;
    items.push(`Long run — ${mi} mi, under ${z2} bpm`);
  }
  if (planned === "lacrosse")
    items.push("Lacrosse — 6pm. That is the whole session.");

  let add = ADDITIONS[planned];
  if (level === "red") return { items: ["Walk if you want to move."], source_date: null, add: null, hold: true };

  return {
    items,
    source_date: source,
    add: add ? { name: add[0], dose: add[1], why: add[2] } : null,
    hold: level !== "green",
  };
}

/* ------------------------------------------------------------- decision */

export function decide(state: ReturnType<typeof buildState>,
                       plan: ReturnType<typeof racePlan>,
                       template: Record<string, Slot>, tun: Tunables, z2: number) {
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
  if (state.hrv_low_streak >= tun.hrv_low_streak_downgrade) {
    reasons.push(`HRV has been below its band ${state.hrv_low_streak} mornings running — that is a deload signal, not a bad night.`);
    level = down(level);
  }

  const tw = state.run_minutes_this_week, lw = state.run_minutes_last_week;
  const overCap = lw > 0 && tw >= lw * (1 + tun.max_weekly_mileage_growth);
  if (overCap)
    reasons.push(`Running ${tw} min this week vs ${lw} last — already at the ${Math.round(tun.max_weekly_mileage_growth * 100)}% cap.`);

  let call: string, detail: string;
  const longMi = plan.long_run_this_week_mi;

  if (level === "red") {
    call = planned === "rest" ? "Rest, as planned." : "Rest today.";
    detail = "Walk if you want to move. Nothing that adds strain.";
  } else if (planned === "rest") {
    call = "Rest day."; detail = "Nothing scheduled. A walk is free.";
  } else if (planned === "lacrosse") {
    call = level === "green" ? "Lacrosse tonight." : "Lacrosse tonight — pace yourself.";
    detail = `Costs about ${Math.abs(tun.cost_lacrosse).toFixed(0)} recovery points, less than a hard run. No lift today.`;
  } else if (planned === "long run") {
    let mi = level === "green" ? longMi : Math.round(longMi * 0.75 * 10) / 10;
    if (overCap) mi = Math.round(mi * 0.85 * 10) / 10;
    call = `Long run — ${mi} miles, easy.`;
    detail = `Stay under ${z2} bpm the whole way. Week ${plan.weeks_out} out; this is the session the race is built on.`;
  } else if ((planned === "pull+run" || planned === "run") && overCap && level !== "green") {
    call = planned === "pull+run" ? "Pull lift only." : "Rest the legs today.";
    detail = `You are already at this week's running cap (${tw} min vs ${lw} last week). Shins flare when volume jumps; the build holds.`;
  } else if (planned === "pull+run" && level !== "green") {
    call = "Pull lift only. Skip the run.";
    detail = `Amber, so the run goes. The lift costs about ${Math.abs(tun.cost_lift_upper).toFixed(1)} recovery points; the run costs ${Math.abs(tun.cost_running).toFixed(0)}.`;
  } else if (planned === "pull+run" || planned === "run") {
    call = level === "green" ? "Easy run, 25–30 minutes." : "Easy run, 20 minutes, or skip it.";
    detail = `Under ${z2} bpm. Running costs you ${Math.abs(tun.cost_running).toFixed(0)} recovery points at your old intensity — zone 2 is the experiment.`;
    if (planned === "pull+run") detail += " Pull lift too: rows, and add a vertical pull.";
  } else if (planned === "legs") {
    call = level === "green" ? "Leg day." : "Leg day — hold the weights where they were.";
    detail = level === "green"
      ? "Quad day costs about 3.5 recovery points. Saturday is far enough away."
      : "Amber recovery. Same session, no load increase.";
  } else {
    call = level === "green" ? "Push lift." : "Push lift — hold at current weights.";
    detail = "Bench stays at 95 with pauses until the shoulder says otherwise.";
  }

  return { level, call, detail, planned, why_today: why, reasons, zone2_ceiling: z2 };
}

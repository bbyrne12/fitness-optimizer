/**
 * Changes to an athlete's plan settings, from anywhere other than the setup
 * form -- the coach, mainly. The same fields the form owns, validated the same
 * way, applied on top of the stored config so nothing else on it is touched.
 */
import { FOCUS_MUSCLES, RACE_DISTANCES, type Distance } from "./decide";
import { slugify, sportLabel } from "./sports";

export const GOALS = ["hrv", "race", "strength", "general"] as const;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const INTENSITIES = ["easy", "moderate", "hard"];
const MAX_NOTES = 4000;

export type PlanPatch = {
  goals?: string[];
  race?: { distance: string; date: string; name?: string } | null;
  week?: { lift_days?: number; run_days?: number; long_run_day?: string };
  activities?: { sport?: string; label?: string; days: string[]; time?: string | null; intensity?: string }[];
  zone2_ceiling_bpm?: number;
  longest_run_mi?: number;
  focus_muscles?: string[];
  notes?: string;
  manual_lifts?: string[];
  cues?: Record<string, string>;
  email_daily?: boolean;
  email_to?: string | null;
  morning_not_before?: string | null;
};

export type PatchResult = {
  config: Record<string, any>;
  /** One line per change made, for the athlete to read. */
  applied: string[];
  /** One line per change refused, and why. */
  rejected: string[];
};

const clampInt = (v: unknown, lo: number, hi: number) =>
  Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : null;

export function applyPlanPatch(prev: Record<string, any>, patch: PlanPatch): PatchResult {
  const config: Record<string, any> = { ...prev };
  const applied: string[] = [], rejected: string[] = [];

  if (patch.goals !== undefined) {
    const goals = [...new Set((patch.goals ?? []).map(String))].filter((g) => (GOALS as readonly string[]).includes(g));
    if (goals.length) {
      config.goals = { ...(config.goals ?? {}), list: goals };
      applied.push(`Goals: ${goals.join(", ")}`);
    } else rejected.push("Goals: none of those is a goal the plan knows (hrv, race, strength, general).");
  }

  if (patch.race !== undefined) {
    if (patch.race === null) {
      config.goals = { ...(config.goals ?? {}), race: null,
        list: ((config.goals?.list ?? []) as string[]).filter((g) => g !== "race") };
      applied.push("Race: removed");
    } else {
      const d = patch.race.distance as Distance;
      const date = String(patch.race.date ?? "");
      if (!RACE_DISTANCES[d]) rejected.push(`Race: "${patch.race.distance}" is not a distance (5k, 10k, half, marathon).`);
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) rejected.push("Race: the date must be YYYY-MM-DD.");
      else {
        const name = String(patch.race.name ?? "").trim().slice(0, 60) || RACE_DISTANCES[d].label;
        const list = [...new Set([...((config.goals?.list ?? []) as string[]), "race"])];
        config.goals = { ...(config.goals ?? {}), list, race: { distance: d, date, name } };
        applied.push(`Race: ${name} (${RACE_DISTANCES[d].label}) on ${date}`);
      }
    }
  }

  if (patch.week) {
    const week = { ...(config.week ?? {}) };
    const lift = patch.week.lift_days === undefined ? null : clampInt(patch.week.lift_days, 0, 5);
    const run = patch.week.run_days === undefined ? null : clampInt(patch.week.run_days, 0, 5);
    if (lift !== null) { week.lift_days = lift; applied.push(`Lift days: ${lift}`); }
    if (run !== null) { week.run_days = run; applied.push(`Run days: ${run}`); }
    if (patch.week.long_run_day !== undefined) {
      const d = patch.week.long_run_day === "Sun" ? "Sun" : patch.week.long_run_day === "Sat" ? "Sat" : null;
      if (d) { week.long_run_day = d; applied.push(`Long run: ${d === "Sat" ? "Saturday" : "Sunday"}`); }
      else rejected.push("Long run day: only Sat or Sun.");
    }
    config.week = week;
  }

  if (patch.activities !== undefined) {
    const rows = [];
    for (const a of patch.activities ?? []) {
      const days = [...new Set((a.days ?? []).map((x) => String(x).slice(0, 3)))]
        .map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).filter((x) => DAYS.includes(x));
      const label = String(a.label ?? a.sport ?? "").trim().slice(0, 40);
      const sport = a.sport ? String(a.sport).trim().toLowerCase() : slugify(label);
      if (!sport || !days.length) { rejected.push(`Activity "${label || sport}": needs a name and at least one day.`); continue; }
      const time = typeof a.time === "string" && /^\d{1,2}:\d{2}$/.test(a.time.trim()) ? a.time.trim().padStart(5, "0") : null;
      const intensity = INTENSITIES.includes(String(a.intensity)) ? String(a.intensity) : "moderate";
      rows.push({ sport, label: label || sportLabel(sport), days: DAYS.filter((d) => days.includes(d)), time, intensity });
    }
    config.activities = rows;
    applied.push(rows.length
      ? `Activities: ${rows.map((r) => `${r.label} ${r.days.join("/")}${r.time ? " " + r.time : ""} (${r.intensity})`).join("; ")}`
      : "Activities: none");
  }

  if (patch.zone2_ceiling_bpm !== undefined) {
    const z = clampInt(patch.zone2_ceiling_bpm, 100, 210);
    if (z) { config.athlete = { ...(config.athlete ?? {}), zone2_ceiling_bpm: z }; applied.push(`Zone 2 ceiling: ${z} bpm`); }
    else rejected.push("Zone 2 ceiling: must be a heart rate between 100 and 210.");
  }

  if (patch.longest_run_mi !== undefined) {
    const mi = Number(patch.longest_run_mi);
    if (Number.isFinite(mi) && mi >= 0 && mi <= 40) {
      config.athlete = { ...(config.athlete ?? {}), longest_run_mi: Math.round(mi * 10) / 10 };
      applied.push(`Longest run: ${Math.round(mi * 10) / 10} mi`);
    } else rejected.push("Longest run: must be a number of miles, 0 to 40.");
  }

  if (patch.focus_muscles !== undefined) {
    const f = [...new Set((patch.focus_muscles ?? []).map((m) => String(m).toLowerCase()))]
      .filter((m) => (FOCUS_MUSCLES as readonly string[]).includes(m));
    config.focus_muscles = f;
    applied.push(f.length ? `Focus: ${f.join(", ")}` : "Focus: none");
  }

  if (patch.notes !== undefined) {
    config.notes = String(patch.notes).trim().slice(0, MAX_NOTES) || null;
    applied.push(config.notes ? "Notes updated" : "Notes cleared");
  }

  if (patch.manual_lifts !== undefined) {
    config.manual_lifts = [...new Set((patch.manual_lifts ?? []).map((s) => String(s).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    applied.push(config.manual_lifts.length ? `Held at current weight: ${config.manual_lifts.join(", ")}` : "No lifts held at current weight");
  }

  if (patch.cues) {
    const cues = { ...(config.cues ?? {}) };
    for (const [k, v] of Object.entries(patch.cues)) {
      if (!["push", "pull", "legs", "upper", "full body", "long run", "run"].includes(k)) continue;
      if (typeof v === "string" && v.trim()) cues[k] = v.trim().slice(0, 120); else delete cues[k];
    }
    config.cues = cues;
    applied.push("Session reminders updated");
  }

  if (patch.email_daily !== undefined) {
    config.email_daily = Boolean(patch.email_daily);
    applied.push(config.email_daily ? "Morning email: on" : "Morning email: off, decision shows in the app");
  }

  // The earliest the morning decision may go out, in the athlete's own local
  // time. It does not schedule anything: it holds the decision back so a
  // recovery score from a 5am wake is not what the day gets built on.
  if (patch.morning_not_before !== undefined) {
    const t = String(patch.morning_not_before ?? "").trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!t) { config.morning_not_before = null; applied.push("Morning email: as soon as WHOOP scores you"); }
    else if (m && Number(m[1]) < 24 && Number(m[2]) < 60 && Number(m[1]) * 60 + Number(m[2]) <= 12 * 60) {
      config.morning_not_before = `${m[1].padStart(2, "0")}:${m[2]}`;
      applied.push(`Morning email: nothing before ${config.morning_not_before}`);
    } else rejected.push("Earliest morning time: use a time like 07:30, and no later than midday.");
  }

  if (patch.email_to !== undefined) {
    const e = String(patch.email_to ?? "").trim();
    if (!e) { config.email_to = null; applied.push("Email address: the one you signed in with"); }
    else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { config.email_to = e; applied.push(`Email address: ${e}`); }
    else rejected.push("Email address: that does not look like an address.");
  }

  return { config, applied, rejected };
}

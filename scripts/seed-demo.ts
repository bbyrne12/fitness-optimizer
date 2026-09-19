/**
 * Builds a demo athlete: an account with invented training data, so a
 * reviewer can sign in and see the app working without a WHOOP membership
 * and without anyone's real data.
 *
 *   DEMO_EMAIL=demo@example.com DEMO_PASSWORD='...' npx tsx scripts/seed-demo.ts
 *
 * Idempotent: running it again resets the demo account to the same state.
 * The demo has no WHOOP tokens, so the morning job never touches it, and its
 * profile asks for no email, so nothing is ever sent from it.
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) process.env[line.slice(0, i)] ??= line.slice(i + 1).replace(/^"|"$/g, "");
}

const EMAIL = process.env.DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Set DEMO_EMAIL and DEMO_PASSWORD, e.g.\n  DEMO_EMAIL=demo@yourdomain.com DEMO_PASSWORD='choose-one' npx tsx scripts/seed-demo.ts");
  process.exit(1);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

const DAY = 864e5;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (day: string, n: number) => iso(new Date(Date.parse(day) + n * DAY));
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dowOf = (day: string) => DOW[new Date(day + "T12:00:00Z").getUTCDay()];
const today = iso(new Date());

// A deterministic wobble, so every run produces the same demo.
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/* ------------------------------------------------------------- the plan */

const RACE_DATE = shift(today, 63);
const config: Record<string, unknown> = {
  goals: { list: ["race", "strength"], race: { distance: "10k", date: RACE_DATE, name: "City 10K" } },
  week: { lift_days: 3, run_days: 2, long_run_day: "Sat" },
  activities: [
    { sport: "basketball", label: "Basketball", days: ["Tue", "Thu"], time: "19:00", intensity: "hard" },
  ],
  athlete: { zone2_ceiling_bpm: 148, longest_run_mi: 5.4 },
  focus_muscles: ["back", "core"],
  notes: "Left knee complains on deep squats, so squats stay where they are for now. Want to finish the 10K under 50 minutes without losing the bench press.",
  manual_lifts: ["squat"],
  cues: { legs: "Knee first: no depth past parallel, and stop a rep short.", pull: "Slow on the way down, no swinging." },
  utc_offset_minutes: -240,
  email_daily: false,
  email_to: null,
  whoop_summary: { updated: today, sports: [], sport_days: {}, max_heart_rate: 191, resting_heart_rate: 52 },
};

/* ------------------------------------------------- eight weeks of lifts */

type SetRow = { day: string; exercise: string; weight: number | null; reps: number | null; sets: number; pin: string | null };
const PUSH: [string, number, number][] = [["Barbell bench", 135, 8], ["Incline dumbbell press", 45, 10], ["Overhead press", 75, 8], ["Tricep pushdown", 50, 12]];
const PULL: [string, number, number][] = [["Lat pulldown", 110, 10], ["Barbell row", 95, 10], ["Face pulls", 40, 15], ["Bicep curls", 25, 12]];
const LEGS: [string, number, number][] = [["Back squat", 155, 8], ["Romanian deadlift", 115, 10], ["Leg press", 270, 12], ["Calf raises", 90, 20]];
const CORE = ["Plank", "Dead bug", "Pallof press"];

const sets: SetRow[] = [];
for (let w = 8; w >= 0; w--) {
  const monday = shift(today, -(w * 7 + ((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7)));
  const bump = (base: number, step: number) => base + Math.round(((8 - w) / 2) * step);
  // The same days the plan schedules: legs Monday, pull Wednesday, push Friday.
  const days: [string, [string, number, number][]][] = [
    [shift(monday, 0), LEGS], [shift(monday, 2), PULL], [shift(monday, 4), PUSH],
  ];
  for (const [day, block] of days) {
    if (day > today) continue;
    for (const [exercise, base, reps] of block) {
      const step = base > 200 ? 10 : base > 100 ? 5 : 2.5;
      const weight = exercise.startsWith("Back squat") ? base : bump(base, step);
      sets.push({ day, exercise, weight, reps: reps - (rnd() < 0.25 ? 1 : 0), sets: 3, pin: null });
    }
    if (block === LEGS) for (const c of CORE)
      sets.push({ day, exercise: c, weight: null, reps: c === "Plank" ? null : 10, sets: 3, pin: c === "Plank" ? "45 sec" : null });
  }
}

/* ------------------------------------ what the engine learned about them */

const COSTS: Record<string, { value: number; n: number; source: string }> = {
  rest: { value: 0, n: 24, source: "measured" },
  "lift:push": { value: -1.4, n: 9, source: "measured" },
  "lift:pull": { value: -1.1, n: 9, source: "measured" },
  "lift:legs": { value: -4.6, n: 9, source: "measured" },
  "run:zone2": { value: -3.2, n: 11, source: "measured" },
  "run:long": { value: -7.4, n: 7, source: "measured" },
  "sport:basketball": { value: -8.1, n: 12, source: "measured" },
};
config.learned = { updated: today, days: {}, costs: COSTS };

/* ------------------------------------------- the last two weeks of calls */

const WEEK: Record<string, string> = {
  Mon: "legs", Tue: "basketball", Wed: "pull+run", Thu: "basketball",
  Fri: "push", Sat: "long run", Sun: "rest",
};
const RECOVERIES = [74, 61, 88, 45, 70, 82, 58, 91, 67, 76, 52, 84, 63, 79];

function sessionFor(planned: string, day: string) {
  const last = (block: [string, number, number][]) => sets.filter((s) => s.day < day && block.some(([e]) => e === s.exercise));
  const lifts = (block: [string, number, number][], kind: string) => {
    const recent = last(block);
    const byName = new Map<string, SetRow>();
    for (const r of recent) byName.set(r.exercise, r);
    const items = [...byName.values()].map((r) => `${r.exercise} — 3 x ${r.reps} @ ${r.weight}`);
    const straight = items.slice(0, 2), circuit = items.slice(2);
    void kind;
    return [
      { title: "Straight sets", note: "All sets of one lift before the next. Rest 2–3 min between sets on the compounds.", items: straight },
      { title: "Mini circuit", note: "One set of each, then round again. About a minute between rounds.", items: circuit },
    ];
  };
  if (planned === "legs") return lifts(LEGS, "legs");
  if (planned === "push") return lifts(PUSH, "push");
  if (planned.startsWith("pull")) {
    const b = lifts(PULL, "pull");
    return [...b, { title: "Also today", note: null, items: ["Easy run — 28 min, under 148 bpm"] }];
  }
  if (planned === "long run") return [{ title: null, note: null, items: ["Long run — 5.4 mi, under 148 bpm"] }];
  if (planned === "basketball") return [{ title: null, note: null, items: ["Basketball — 7pm. That is the whole session."] }];
  return [{ title: null, note: null, items: ["Rest. A walk is free."] }];
}

const decisions: { user_id: string; day: string; emailed_at: string | null; decision: Record<string, unknown> }[] = [];
for (let i = 13; i >= 0; i--) {
  const day = shift(today, -i);
  const dow = dowOf(day);
  const planned = WEEK[dow];
  const rec = RECOVERIES[13 - i];
  const level = rec >= 67 ? "green" : rec < 34 ? "red" : "yellow";
  const blocks = sessionFor(planned, day);
  const call =
    planned === "rest" ? "Rest day."
    : planned === "basketball" ? (level === "green" ? "Basketball tonight." : "Basketball tonight — pace yourself.")
    : planned === "long run" ? `Long run — ${level === "green" ? 5.4 : 4.1} miles, easy.`
    : planned === "legs" ? "Leg day."
    : planned === "push" ? "Push lift."
    : level === "green" ? "Pull lift and an easy run." : "Pull lift only. Skip the run.";
  const reasons = [`Recovery ${rec}% (${level}).`];
  if (level !== "green") reasons.push("Sleep debt 1.8h.");
  if (rec < 55) reasons.push("Resting HR is 6 bpm over baseline — mild system stress.");
  decisions.push({
    user_id: "", day,
    emailed_at: null,
    decision: {
      state: { date: day, dow, recovery: rec, hrv: 58 + Math.round(rnd() * 14), rhr: 52 + Math.round(rnd() * 5),
        sleep_hours: Math.round((6.4 + rnd() * 1.6) * 10) / 10, sleep_debt_h: level === "green" ? 0.4 : 1.8,
        hrv_low_streak: level === "green" ? 0 : 1, recovery_baseline: 71, rhr_baseline: 52, hrv_baseline: 64 },
      decision: {
        level, call, planned, reasons,
        detail: planned === "basketball"
          ? "Costs you about 8 recovery points more than a rest day (from 12 of your days). No lift today."
          : planned === "legs"
            ? "Leg day costs you about 4.6 recovery points more than a rest day (from 9 of your days)."
            : planned === "long run"
              ? "Stay under 148 bpm the whole way. Week 9 out; this is the session the race is built on."
              : "Upper body only — costs you about 1.4 recovery points more than a rest day (from 9 of your days).",
        zone2_ceiling: 148, deload_advised: false,
      },
      session: {
        items: blocks.flatMap((b) => b.items), blocks,
        add: planned === "rest"
          ? { name: "Core circuit", dose: "3 movements, about 10 min", why: "Core is one of your focus areas, and a rest day is where it fits. Your own routine, as you last did it." }
          : { name: "Face pulls", dose: "3 x 12", why: "Rear delts and scapular control, to balance the pressing." },
        hold: level !== "green",
      },
      plan: { race_date: RACE_DATE, race_miles: 6.2, weeks_out: 9, has_race: true, long_run_this_week_mi: 5.4, easy_run_minutes: 28 },
      session_costs: COSTS,
    },
  });
}

/* ----------------------------------------------------------------- write */

async function main() {
  const { data: list } = await db.auth.admin.listUsers({ perPage: 200 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === EMAIL!.toLowerCase());
  let userId: string;
  if (existing) {
    userId = existing.id;
    const { error } = await db.auth.admin.updateUserById(userId, { password: PASSWORD, email_confirm: true });
    if (error) throw new Error(`could not update the demo account: ${error.message}`);
    console.log(`demo account exists (${userId}); password reset`);
  } else {
    const { data, error } = await db.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`could not create the demo account: ${error?.message}`);
    userId = data.user.id;
    console.log(`demo account created (${userId})`);
  }

  for (const t of ["athlete_sets", "decision_log", "workout_logs", "whoop_tokens"])
    await db.from(t).delete().eq("user_id", userId);

  const { error: profErr } = await db.from("athlete_profile").upsert(
    { user_id: userId, config, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (profErr) throw new Error(`profile: ${profErr.message}`);

  // The onboarding row, so the dashboard does not send the demo to /onboarding.
  const { error: pErr } = await db.from("profiles").upsert({
    id: userId, primary_goal: "Build Strength", experience_level: "Intermediate (1-3 years)",
    available_equipment: ["Barbell and plates", "Dumbbells", "Machines"], available_days: [1, 2, 3, 4, 5, 6],
  }, { onConflict: "id" });
  if (pErr) console.error("profiles:", pErr.message);

  for (let i = 0; i < sets.length; i += 500) {
    const { error } = await db.from("athlete_sets").insert(sets.slice(i, i + 500).map((s) => ({ ...s, user_id: userId })));
    if (error) throw new Error(`sets: ${error.message}`);
  }
  const { error: decErr } = await db.from("decision_log")
    .upsert(decisions.map((d) => ({ ...d, user_id: userId })), { onConflict: "user_id,day" });
  if (decErr) throw new Error(`decisions: ${decErr.message}`);

  console.log(`seeded ${sets.length} logged sets across ${new Set(sets.map((s) => s.day)).size} days, and ${decisions.length} daily decisions ending today.`);
  console.log(`sign in at /auth/login as ${EMAIL}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

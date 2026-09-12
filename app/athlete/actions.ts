"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { disconnect } from "@/lib/athlete/whoop";
import { RACE_DISTANCES, type Distance } from "@/lib/athlete/decide";

export type SetupResult = { ok: boolean; message: string };

const GOALS = ["hrv", "race", "strength", "general"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const INTENSITIES = ["easy", "moderate", "hard"];
/** Session kinds the engine uses itself; an activity cannot take one of these names. */
const RESERVED = new Set(["run", "rest", "legs", "pull", "push", "upper", "running", "weightlifting"]);
/** Profile keys edited as raw JSON. Whatever is in the box replaces them. */
const ADVANCED_KEYS = ["cues", "additions", "tunables", "cadence_spm"];
const MAX_ACTIVITIES = 10;

const fail = (message: string): SetupResult => ({ ok: false, message });

const dayCount = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return v !== null && Number.isInteger(n) && n >= 0 && n <= 5 ? n : null;
};

export async function saveAthleteProfile(
  _prev: SetupResult | null,
  form: FormData,
): Promise<SetupResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Sign in first.");

  const goal = String(form.get("goal") ?? "");
  if (!GOALS.includes(goal)) return fail("Pick a main goal.");

  const distance = String(form.get("race_distance") ?? "");
  let race: { distance: Distance; date: string; name: string } | null = null;
  if (distance) {
    if (!RACE_DISTANCES[distance as Distance]) return fail("Pick a race distance.");
    const date = String(form.get("race_date") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))
      return fail("A race needs a date: the plan counts down to it.");
    if (Date.parse(date) < Date.now() - 864e5) return fail("That race date has already passed.");
    const d = distance as Distance;
    race = {
      distance: d,
      date,
      name: String(form.get("race_name") ?? "").trim().slice(0, 60) || RACE_DISTANCES[d].label,
    };
  }
  if (goal === "race" && !race) return fail("Training for a race needs a distance and a date.");

  const liftDays = dayCount(form.get("lift_days"));
  const runDays = dayCount(form.get("run_days"));
  if (liftDays === null || runDays === null)
    return fail("Choose how many days to lift and to run, from 0 to 5.");
  if (race && runDays < 1) return fail("A race plan needs at least one run a week.");
  const longRunDay = form.get("long_run_day") === "Sun" ? "Sun" : "Sat";

  let rows: any[];
  try {
    rows = JSON.parse(String(form.get("activities") || "[]"));
    if (!Array.isArray(rows)) throw new Error();
  } catch {
    return fail("The activities could not be read. Reload the page and try again.");
  }
  const activities: Record<string, unknown>[] = [];
  for (const a of rows) {
    const label = String(a?.label ?? "").trim().slice(0, 40);
    const sport = String(a?.sport ?? "").trim().toLowerCase();
    const picked = new Set((Array.isArray(a?.days) ? a.days : []).map(String));
    const days = DAYS.filter((d) => picked.has(d));
    if (!sport && !days.length) continue; // an empty row that was added and left
    if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(sport) || RESERVED.has(sport))
      return fail(`Choose what ${label ? `"${label}"` : "each activity"} is.`);
    if (!days.length) return fail(`Pick at least one day for ${label || sport}.`);
    const time = String(a?.time ?? "");
    if (time && !/^\d{2}:\d{2}$/.test(time)) return fail(`The start time for ${label || sport} is not a time.`);
    activities.push({
      sport,
      label: label || sport,
      days,
      time: time || null,
      intensity: INTENSITIES.includes(a?.intensity) ? a.intensity : "moderate",
    });
  }
  if (activities.length > MAX_ACTIVITIES) return fail(`Up to ${MAX_ACTIVITIES} activities.`);

  const zone2 = Number(form.get("zone2"));
  if (!Number.isFinite(zone2) || zone2 < 90 || zone2 > 200)
    return fail("Zone 2 ceiling should be a heart rate between 90 and 200.");

  const longest = Number(form.get("longest_run_mi") || 0);
  if (!Number.isFinite(longest) || longest < 0 || longest > 100)
    return fail("Longest run should be a distance in miles.");

  const manualLifts = String(form.get("manual_lifts") ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 20);

  const emailTo = String(form.get("email_to") ?? "").trim();
  if (emailTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo))
    return fail("That email address does not look right.");

  let advanced: Record<string, unknown> = {};
  const raw = String(form.get("advanced") ?? "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return fail("Advanced settings must be a JSON object.");
      const unknown = Object.keys(parsed).filter((k) => !ADVANCED_KEYS.includes(k));
      if (unknown.length) return fail(`Unknown advanced setting: ${unknown.join(", ")}.`);
      advanced = parsed;
    } catch {
      return fail("Advanced settings are not valid JSON.");
    }
  }

  const { data: existing } = await supabase
    .from("athlete_profile").select("config").eq("user_id", user.id).maybeSingle();
  const prev = (existing?.config ?? {}) as Record<string, any>;

  // Keys the form does not own -- exercise matches, the WHOOP summary, the
  // learned time zone -- are carried over untouched.
  const config: Record<string, any> = {
    ...prev,
    goals: { primary: goal, race },
    week: { lift_days: liftDays, run_days: runDays, long_run_day: longRunDay },
    activities,
    athlete: { ...(prev.athlete ?? {}), zone2_ceiling_bpm: Math.round(zone2), longest_run_mi: longest },
    manual_lifts: manualLifts,
    email_to: emailTo || null,
  };
  // Superseded by goals, week and activities; left behind they would disagree.
  delete config.race;
  delete config.lacrosse;
  delete config.tennis;
  for (const k of ADVANCED_KEYS) {
    if (k in advanced) config[k] = advanced[k];
    else delete config[k];
  }

  const { error } = await supabase.from("athlete_profile").upsert(
    { user_id: user.id, config, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) return fail(`Could not save: ${error.message}`);

  revalidatePath("/athlete");
  revalidatePath("/calendar");
  return { ok: true, message: "Saved. Tomorrow's plan uses these answers." };
}

export async function disconnectWhoop() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await disconnect(user.id);
  revalidatePath("/athlete");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { disconnect } from "@/lib/athlete/whoop";
import { FOCUS_MUSCLES, RACE_DISTANCES, type Distance } from "@/lib/athlete/decide";
import { readNotes } from "@/lib/athlete/notes";

export type SetupResult = { ok: boolean; message: string };

const GOALS = ["hrv", "race", "strength", "general"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const INTENSITIES = ["easy", "moderate", "hard"];
/** Session kinds the engine uses itself; an activity cannot take one of these names. */
const RESERVED = new Set(["run", "rest", "legs", "pull", "push", "upper", "running", "weightlifting"]);
const MAX_ACTIVITIES = 10;
const MAX_NOTES = 2000;

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

  const goals = [...new Set(form.getAll("goal").map(String))].filter((g) => GOALS.includes(g));
  if (!goals.length) return fail("Pick at least one goal.");

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
  if (goals.includes("race") && !race) return fail("Training for a race needs a distance and a date.");

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

  const focus = [...new Set(form.getAll("focus").map(String))]
    .filter((m) => (FOCUS_MUSCLES as readonly string[]).includes(m));

  const notes = String(form.get("notes") ?? "").trim().slice(0, MAX_NOTES);

  const emailTo = String(form.get("email_to") ?? "").trim();
  if (emailTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo))
    return fail("That email address does not look right.");

  const { data: existing } = await supabase
    .from("athlete_profile").select("config").eq("user_id", user.id).maybeSingle();
  const prev = (existing?.config ?? {}) as Record<string, any>;

  // The notes are read by Claude into the things the engine acts on -- lifts
  // to hold, per-session cues -- once, when they change. Unchanged notes keep
  // their last reading; cleared notes clear what was read from them.
  let notesRead = prev.notes_read ?? null;
  let notesWarning = "";
  if (notes !== (prev.notes ?? "")) {
    if (!notes) notesRead = null;
    else {
      try {
        notesRead = await readNotes(notes);
        if (!notesRead) notesWarning = " Notes saved, but reading them into the plan is not set up on this deployment.";
      } catch (e) {
        console.error("[saveAthleteProfile] readNotes:", e instanceof Error ? e.message : e);
        notesWarning = " Notes saved, but they could not be read into the plan just now; save again later to retry.";
      }
    }
  }

  // Keys the form does not own -- exercise matches, the WHOOP summary, the
  // learned time zone, additions, tunables -- are carried over untouched.
  const config: Record<string, any> = {
    ...prev,
    goals: { list: goals, race },
    week: { lift_days: liftDays, run_days: runDays, long_run_day: longRunDay },
    activities,
    athlete: { ...(prev.athlete ?? {}), zone2_ceiling_bpm: Math.round(zone2), longest_run_mi: longest },
    focus_muscles: focus,
    notes: notes || null,
    notes_read: notesRead,
    email_to: emailTo || null,
  };
  // What was read from the notes is what the engine holds and reminds; when the
  // notes have been read, they are the source, otherwise earlier values stand.
  if (notesRead) {
    config.manual_lifts = notesRead.manual_lifts;
    config.cues = { ...(prev.cues ?? {}), ...notesRead.cues };
  } else if (notes === "" && prev.notes) {
    config.manual_lifts = [];
  }
  // Superseded by goals, week and activities; left behind they would disagree.
  delete config.race;
  delete config.lacrosse;
  delete config.tennis;

  const { error } = await supabase.from("athlete_profile").upsert(
    { user_id: user.id, config, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) return fail(`Could not save: ${error.message}`);

  revalidatePath("/athlete");
  revalidatePath("/calendar");
  revalidatePath("/protected");
  // Back to the dashboard, which shows the confirmation. Anything that went
  // wrong reading the notes travels with it, so it is not lost to the redirect.
  redirect(`/protected?saved=1${notesWarning ? `&notes=${encodeURIComponent(notesWarning.trim())}` : ""}`);
}

export async function disconnectWhoop() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await disconnect(user.id);
  revalidatePath("/athlete");
}

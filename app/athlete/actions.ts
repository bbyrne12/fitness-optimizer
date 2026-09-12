"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { disconnect } from "@/lib/athlete/whoop";

export type SetupResult = { ok: boolean; message: string };

// Saturday is the long run and Sunday is rest in every week the engine builds,
// so fixtures can only go on weekdays.
const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

/** Profile keys edited as raw JSON. Whatever is in the box replaces them. */
const ADVANCED_KEYS = ["cues", "additions", "manual_lifts", "tunables", "cadence_spm"];

export async function saveAthleteProfile(
  _prev: SetupResult | null,
  form: FormData,
): Promise<SetupResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in first." };

  const raceDate = String(form.get("race_date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate) || Number.isNaN(Date.parse(raceDate)))
    return { ok: false, message: "A race date is required: the whole plan counts down to it." };

  const zone2 = Number(form.get("zone2"));
  if (!Number.isFinite(zone2) || zone2 < 90 || zone2 > 200)
    return { ok: false, message: "Zone 2 ceiling should be a heart rate between 90 and 200." };

  const longest = Number(form.get("longest_run_mi") || 0);
  if (!Number.isFinite(longest) || longest < 0 || longest > 100)
    return { ok: false, message: "Longest run should be a distance in miles." };

  const emailTo = String(form.get("email_to") ?? "").trim();
  if (emailTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo))
    return { ok: false, message: "That email address does not look right." };

  const days = (name: string) =>
    [...new Set(form.getAll(name).map(String))].filter((d) => WEEKDAYS.has(d));
  const lacrosseDays = days("lacrosse_days");
  // A day cannot hold both fixtures; team practice keeps it.
  const tennisDays = days("tennis_days").filter((d) => !lacrosseDays.includes(d));
  const lacrosseTime = String(form.get("lacrosse_time") ?? "").trim();

  let advanced: Record<string, unknown> = {};
  const raw = String(form.get("advanced") ?? "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return { ok: false, message: "Advanced settings must be a JSON object." };
      const unknown = Object.keys(parsed).filter((k) => !ADVANCED_KEYS.includes(k));
      if (unknown.length)
        return { ok: false, message: `Unknown advanced setting: ${unknown.join(", ")}.` };
      advanced = parsed;
    } catch {
      return { ok: false, message: "Advanced settings are not valid JSON." };
    }
  }

  const { data: existing } = await supabase
    .from("athlete_profile").select("config").eq("user_id", user.id).maybeSingle();
  const prev = (existing?.config ?? {}) as Record<string, any>;

  // Keys this form does not own (exercise matches, the learned time zone) are
  // carried over untouched.
  const config: Record<string, any> = {
    ...prev,
    race: {
      ...(prev.race ?? {}),
      name: String(form.get("race_name") || "Half marathon").trim(),
      date: raceDate,
      longest_run_ever_mi: longest,
    },
    athlete: { ...(prev.athlete ?? {}), zone2_ceiling_bpm: Math.round(zone2) },
    lacrosse: { ...(prev.lacrosse ?? {}), days: lacrosseDays, time: lacrosseTime || null },
    tennis: { ...(prev.tennis ?? {}), days: tennisDays },
    email_to: emailTo || null,
  };
  for (const k of ADVANCED_KEYS) {
    if (k in advanced) config[k] = advanced[k];
    else delete config[k];
  }

  const { error } = await supabase.from("athlete_profile").upsert(
    { user_id: user.id, config, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, message: `Could not save: ${error.message}` };

  revalidatePath("/athlete");
  revalidatePath("/calendar");
  return { ok: true, message: "Saved." };
}

export async function disconnectWhoop() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await disconnect(user.id);
  revalidatePath("/athlete");
}

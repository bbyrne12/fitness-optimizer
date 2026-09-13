"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { parseLog } from "@/lib/athlete/parse-log";
import { resolveExercises, type AliasMap } from "@/lib/athlete/resolve-exercises";

export type SaveResult = {
  ok: boolean;
  message: string;
  days?: string[];
  sets?: number;
  unparsed?: string[];
};

/**
 * Paste in whatever is in Notes; this reads the typed format and writes it to
 * the signed-in athlete's log. Re-pasting the same days replaces them rather
 * than duplicating, so pasting the whole month again is safe.
 *
 * Runs on the athlete's own session, so row-level security confines every read
 * and write to their rows; the user_id filters say the same thing explicitly.
 */
export async function saveLog(
  _prev: SaveResult | null,
  form: FormData,
): Promise<SaveResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to save a workout." };

  const text = String(form.get("log") ?? "").trim();
  if (!text) return { ok: false, message: "Nothing pasted." };

  const year = Number(form.get("year")) || new Date().getFullYear();
  const { data: prof } = await supabase
    .from("athlete_profile").select("config").eq("user_id", user.id).maybeSingle();
  const cfg = (prof?.config ?? {}) as Record<string, any>;
  // The athlete's local "today", so a session typed at 9pm does not land on
  // tomorrow's date. The offset is learned from their WHOOP records.
  const today = new Date(Date.now() + (cfg.utc_offset_minutes ?? 0) * 60_000)
    .toISOString().slice(0, 10);
  const { sets, unparsed, dated } = parseLog(text, year, today);

  if (!sets.length) {
    return {
      ok: false,
      message:
        "Nothing to save. Lines need to look like \"Leg press: 320 x 12\".",
      unparsed: unparsed.slice(0, 8),
    };
  }

  const days = [...new Set(sets.map((s) => s.day))].sort();

  // Replace the pasted days outright: pasting a corrected day should fix it,
  // not add a second copy of it.
  const { error: delErr } = await supabase
    .from("athlete_sets").delete().eq("user_id", user.id).in("day", days);
  if (delErr) return { ok: false, message: `Could not clear those days: ${delErr.message}` };

  // Work out what the typed names mean before saving, so anything unmatched
  // can be shown now rather than quietly counting toward nothing.
  const aliases = (cfg.exercise_aliases ?? {}) as AliasMap;

  const { map, added } = await resolveExercises(
    sets.map((s) => s.exercise), supabase, aliases);

  if (Object.keys(added).length) {
    const { error: profErr } = await supabase.from("athlete_profile").upsert(
      { user_id: user.id, config: { ...cfg, exercise_aliases: map },
        updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (profErr) console.error("[saveLog] could not store exercise matches:", profErr.message);
  }

  const { error: insErr } = await supabase.from("athlete_sets").insert(
    sets.map((s) => ({
      user_id: user.id,
      day: s.day, exercise: s.exercise, weight: s.weight,
      reps: s.reps, sets: s.sets, pin: s.pin,
    })),
  );
  if (insErr) return { ok: false, message: `Could not save: ${insErr.message}` };

  revalidatePath("/calendar");
  revalidatePath("/log-workout");
  // Saved: back to the journal, which now shows it. Only a failure stays on
  // the paste box, so the text is still there to fix.
  redirect(`/log-workout?saved=${sets.length}&days=${days.length}${dated ? "" : "&today=1"}`);
}

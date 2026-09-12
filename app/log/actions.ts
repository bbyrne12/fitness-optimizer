"use server";

import { revalidatePath } from "next/cache";
import { admin } from "@/lib/athlete/supabase";
import { isAthleteOwner } from "@/lib/athlete/owner";
import { parseLog } from "@/lib/athlete/parse-log";
import { resolveExercises, norm, type AliasMap } from "@/lib/athlete/resolve-exercises";

export type SaveResult = {
  ok: boolean;
  message: string;
  days?: string[];
  sets?: number;
  unparsed?: string[];
  /** What each new exercise name was matched to, and how. */
  matched?: { name: string; muscle: string; source: string }[];
};

/**
 * Paste in whatever is in Notes; this reads the typed format and writes it
 * to Supabase. Re-pasting the same days replaces them rather than duplicating,
 * so pasting the whole month again is safe.
 */
export async function saveLog(
  _prev: SaveResult | null,
  form: FormData,
): Promise<SaveResult> {
  // Writes to one person's athlete_sets with the service role key.
  if (!(await isAthleteOwner())) return { ok: false, message: "Not authorised." };

  const text = String(form.get("log") ?? "").trim();
  if (!text) return { ok: false, message: "Nothing pasted." };

  const year = Number(form.get("year")) || new Date().getFullYear();
  // The athlete's local "today", so a session typed at 9pm does not land on
  // tomorrow's date. The UTC offset is profile data.
  const db = admin();
  const { data: prof } = await db
    .from("athlete_profile").select("config").eq("id", "singleton").single();
  const cfg = (prof?.config ?? {}) as Record<string, any>;
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
  const { error: delErr } = await db.from("athlete_sets").delete().in("day", days);
  if (delErr) return { ok: false, message: `Could not clear those days: ${delErr.message}` };

  // Work out what the typed names mean before saving, so anything unmatched
  // can be shown now rather than quietly counting toward nothing.
  const aliases = (cfg.exercise_aliases ?? {}) as AliasMap;

  const { map, added } = await resolveExercises(
    sets.map((s) => s.exercise), db, aliases);

  if (Object.keys(added).length) {
    await db.from("athlete_profile").upsert({
      id: "singleton",
      config: { ...cfg, exercise_aliases: map },
      updated_at: new Date().toISOString(),
    });
  }

  const matched = [...new Set(sets.map((s) => s.exercise))].map((name) => {
    const r = map[norm(name)];
    return {
      name,
      muscle: r?.primary_muscle || "no match",
      source: r?.source ?? "unresolved",
    };
  });

  const { error: insErr } = await db.from("athlete_sets").insert(
    sets.map((s) => ({
      day: s.day, exercise: s.exercise, weight: s.weight,
      reps: s.reps, sets: s.sets, pin: s.pin,
    })),
  );
  if (insErr) return { ok: false, message: `Could not save: ${insErr.message}` };

  revalidatePath("/calendar");
  revalidatePath("/log-workout");
  return {
    ok: true,
    message:
      `Saved ${sets.length} sets across ${days.length} ` +
      `${days.length === 1 ? "session" : "sessions"}.` +
      (dated ? "" : ` No date written, so it was filed under today.`),
    days, sets: sets.length,
    unparsed: unparsed.slice(0, 8),
    matched,
  };
}

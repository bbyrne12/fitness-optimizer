"use server";

import { revalidatePath } from "next/cache";
import { admin } from "@/lib/athlete/supabase";
import { parseLog } from "@/lib/athlete/parse-log";

export type SaveResult = {
  ok: boolean;
  message: string;
  days?: string[];
  sets?: number;
  unparsed?: string[];
};

/**
 * Paste in whatever is in Notes; this reads it in his own format and writes it
 * to Supabase. Re-pasting the same days replaces them rather than duplicating,
 * so pasting the whole month again is safe.
 */
export async function saveLog(
  _prev: SaveResult | null,
  form: FormData,
): Promise<SaveResult> {
  const text = String(form.get("log") ?? "").trim();
  if (!text) return { ok: false, message: "Nothing pasted." };

  const year = Number(form.get("year")) || new Date().getFullYear();
  const { sets, unparsed } = parseLog(text, year);

  if (!sets.length) {
    return {
      ok: false,
      message:
        "No sessions found. Each session needs a date line like \"9/14:\" above its exercises.",
      unparsed: unparsed.slice(0, 8),
    };
  }

  const days = [...new Set(sets.map((s) => s.day))].sort();
  const db = admin();

  // Replace the pasted days outright: pasting a corrected day should fix it,
  // not add a second copy of it.
  const { error: delErr } = await db.from("athlete_sets").delete().in("day", days);
  if (delErr) return { ok: false, message: `Could not clear those days: ${delErr.message}` };

  const { error: insErr } = await db.from("athlete_sets").insert(
    sets.map((s) => ({
      day: s.day, exercise: s.exercise, weight: s.weight,
      reps: s.reps, sets: s.sets, pin: s.pin,
    })),
  );
  if (insErr) return { ok: false, message: `Could not save: ${insErr.message}` };

  revalidatePath("/calendar");
  return {
    ok: true,
    message: `Saved ${sets.length} sets across ${days.length} ${days.length === 1 ? "session" : "sessions"}.`,
    days, sets: sets.length,
    unparsed: unparsed.slice(0, 8),
  };
}

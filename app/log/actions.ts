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
  // Local "today" (America/New_York), so a session typed at 9pm does not land
  // on tomorrow's date.
  const today = new Date(Date.now() - 240 * 60_000).toISOString().slice(0, 10);
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
    message:
      `Saved ${sets.length} sets across ${days.length} ` +
      `${days.length === 1 ? "session" : "sessions"}.` +
      (dated ? "" : ` No date written, so it was filed under today.`),
    days, sets: sets.length,
    unparsed: unparsed.slice(0, 8),
  };
}

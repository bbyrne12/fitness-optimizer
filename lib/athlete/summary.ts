import "server-only";

import { admin } from "./supabase";
import { body, pull } from "./whoop";
import { whoopSportSummary } from "./decide";

/**
 * Reads an athlete's WHOOP history once and stores what the setup page shows:
 * every sport they have recorded and what it costs them, plus the heart-rate
 * numbers behind the zone 2 suggestion. Called right after they connect, so
 * none of it waits for the first morning email.
 */
export async function saveWhoopSummary(userId: string, at: string) {
  const [w, measured] = await Promise.all([pull(at), body(at).catch(() => null)]);
  const latest = (w.recovery as any[])
    .filter((r) => r.score)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];

  const db = admin();
  const { data } = await db
    .from("athlete_profile").select("config").eq("user_id", userId).maybeSingle();
  const cfg = (data?.config ?? {}) as Record<string, any>;

  const { error } = await db.from("athlete_profile").upsert(
    {
      user_id: userId,
      config: {
        ...cfg,
        whoop_summary: {
          ...(cfg.whoop_summary ?? {}),
          updated: new Date().toISOString().slice(0, 10),
          sports: whoopSportSummary(w),
          max_heart_rate: measured?.max_heart_rate ?? cfg.whoop_summary?.max_heart_rate ?? null,
          resting_heart_rate: latest?.score?.resting_heart_rate ?? null,
        },
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`could not store WHOOP summary: ${error.message}`);
}

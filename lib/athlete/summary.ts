import "server-only";

import { admin } from "./supabase";
import { body, pullHistory } from "./whoop";
import { mergeSportDays, summarizeSportDays, whoopSportDays } from "./decide";

/**
 * Reads an athlete's whole WHOOP history once and stores what the setup page
 * shows: every sport they have recorded and what it costs them, plus the
 * heart-rate numbers behind the zone 2 suggestion. The morning job only reads
 * the last few months, so this is where older history gets measured; the job
 * then adds each new day to it rather than replacing it.
 */
export async function saveWhoopSummary(userId: string, at: string) {
  const history = await pullHistory(at);
  const measured = await body(at).catch(() => null);
  const latest = (history.recovery as any[])
    .filter((r) => r.score)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];

  const db = admin();
  const { data } = await db
    .from("athlete_profile").select("config").eq("user_id", userId).maybeSingle();
  const cfg = (data?.config ?? {}) as Record<string, any>;
  const sportDays = mergeSportDays(cfg.whoop_summary?.sport_days ?? {}, whoopSportDays(history));

  const { error } = await db.from("athlete_profile").upsert(
    {
      user_id: userId,
      config: {
        ...cfg,
        whoop_summary: {
          ...(cfg.whoop_summary ?? {}),
          updated: new Date().toISOString().slice(0, 10),
          sport_days: sportDays,
          sports: summarizeSportDays(sportDays),
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

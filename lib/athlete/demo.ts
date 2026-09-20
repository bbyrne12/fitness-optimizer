import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The demo account: a fabricated athlete whose login goes out with a job
 * application. Strangers use it, so it changes nothing. The database enforces
 * that (db/migrations/005_demo_read_only.sql); this is here so the app says
 * why in a sentence instead of showing a row-level security error.
 *
 * The account marks itself, in its own profile, so nothing in the code or the
 * repository has to name a person or an address.
 */
export const DEMO_MESSAGE =
  "This is the demo account, so nothing is saved. The data is made up, and it stays as the next person will find it.";

export const isDemo = (cfg: unknown): boolean =>
  Boolean(cfg && typeof cfg === "object" && (cfg as { demo?: unknown }).demo === true);

/** One small read, for the write paths that do not already have the config. */
export async function demoAccount(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("athlete_profile")
    .select("config->demo").eq("user_id", userId).maybeSingle();
  return (data as { demo?: unknown } | null)?.demo === true;
}

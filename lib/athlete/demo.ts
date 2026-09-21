import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The demo account: a fabricated athlete whose login goes out with a job
 * application. Strangers use it, so the line is between the plan and the
 * record of what was trained.
 *
 * The plan is theirs to change -- the coach, the setup answers, the week --
 * because a demo you cannot touch is a screenshot, and arguing with the coach
 * is the thing worth seeing. It is put back every night from a copy they
 * cannot reach (/api/demo/reset), so the next reviewer starts where the last
 * one did.
 *
 * The eight weeks of logged sets are not theirs to change. They are what the
 * engine learned this athlete's costs from; deleted, the app has nothing to
 * say. The database refuses those writes (db/migrations/005_demo_account.sql);
 * the message below is here so the app says why in a sentence instead of
 * showing a row-level security error.
 *
 * The account marks itself, in its own profile, so nothing in the code or the
 * repository has to name a person or an address.
 */
export const DEMO_MESSAGE =
  "This is the demo account, so the training log stays as it is — it is what the plan was learned from. " +
  "The plan itself you can change: try the coach.";

/** Shown in the app, so nobody wonders whose health data they are reading. */
export const DEMO_NOTICE =
  "Demo account. The athlete and the data are made up. Change the plan freely — it resets overnight.";

export const isDemo = (cfg: unknown): boolean =>
  Boolean(cfg && typeof cfg === "object" && (cfg as { demo?: unknown }).demo === true);

/** One small read, for the write paths that do not already have the config. */
export async function demoAccount(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("athlete_profile")
    .select("config->demo").eq("user_id", userId).maybeSingle();
  return (data as { demo?: unknown } | null)?.demo === true;
}

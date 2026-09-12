import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * The athlete_* tables hold one person's training data and are read and written
 * with the service role key, which bypasses RLS. Every page and action that
 * touches them has to check this first; being signed in is not enough, because
 * anyone can sign up.
 *
 * A user id is not a secret, so the default lives here. ATHLETE_USER_ID
 * overrides it without a code change.
 */
export const ATHLETE_OWNER_ID =
  process.env.ATHLETE_USER_ID ?? "37158e70-b99b-47a2-b5d2-abc1170c0396";

export async function isAthleteOwner(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return !!user && user.id === ATHLETE_OWNER_ID;
}

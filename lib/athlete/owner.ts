import "server-only";
import { createClient } from "@/lib/supabase/server";
import { admin } from "./supabase";

/**
 * The athlete_* tables hold one person's training data and are read and written
 * with the service role key, which bypasses RLS. Every page and action that
 * touches them has to check this first; being signed in is not enough, because
 * anyone can sign up.
 *
 * Who that person is lives on the profile (`owner_user_id`), not in code, so a
 * different deployment only needs a different profile. ATHLETE_USER_ID
 * overrides it. With neither set, nobody is the owner: this fails closed.
 */
export async function athleteOwnerId(): Promise<string | null> {
  if (process.env.ATHLETE_USER_ID) return process.env.ATHLETE_USER_ID;
  const { data } = await admin()
    .from("athlete_profile").select("config").eq("id", "singleton").maybeSingle();
  const id = (data?.config as Record<string, unknown> | undefined)?.owner_user_id;
  return typeof id === "string" && id ? id : null;
}

export async function isAthleteOwner(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  return user.id === (await athleteOwnerId());
}

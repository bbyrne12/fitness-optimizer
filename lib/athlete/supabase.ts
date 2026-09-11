/**
 * Service-role Supabase client.
 *
 * Every Athlete OS table has RLS on with no policies, so only this client can
 * touch them. It must never be imported into a client component -- the key it
 * carries bypasses RLS entirely.
 */
import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function admin(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set",
    );
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

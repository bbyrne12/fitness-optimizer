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

const TRANSIENT = /gateway timeout|bad gateway|service unavailable|fetch failed|unexpected token|socket hang up|ECONNRESET|ETIMEDOUT/i;

/**
 * Runs a Supabase call again when the API gateway fails transiently. The
 * gateway in front of the database returns 502/503/504 for a few percent of
 * requests in a bad minute while the database itself is idle; the morning job
 * makes about ten calls per poll, so without this a bad minute costs the poll.
 * Takes a factory rather than a query so each attempt builds a fresh request.
 * Everything passed through here is a read or an upsert keyed on the athlete,
 * so repeating it is safe.
 */
export async function retrying<T extends { error: unknown }>(
  call: () => PromiseLike<T>, tries = 3,
): Promise<T> {
  let last: T | undefined;
  for (let i = 0; ; i++) {
    try {
      last = await call();
    } catch (e) {
      if (i >= tries - 1 || !TRANSIENT.test(e instanceof Error ? e.message : String(e))) throw e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
      continue;
    }
    const msg = (last.error as { message?: string } | null)?.message ?? "";
    if (!last.error || i >= tries - 1 || !TRANSIENT.test(msg)) return last;
    await new Promise((r) => setTimeout(r, 400 * 2 ** i));
  }
}

/**
 * GET /api/morning
 *
 * A scheduler polls this through the morning. For every athlete with WHOOP
 * connected it sends at most one email a day, and only once WHOOP has actually
 * scored that athlete's recovery -- which lands shortly after waking, and
 * waking time varies by hours from day to day. A fixed alarm would be hours
 * late most mornings.
 *
 * ?dry=1        run everything, send nothing, return the decisions
 * ?force=1      send even if today has already been emailed
 * ?user=<uuid>  run for one athlete only
 */
import { NextRequest, NextResponse } from "next/server";

import { admin, retrying } from "@/lib/athlete/supabase";
import { runMorning } from "@/lib/athlete/run-morning";

// No `dynamic = "force-dynamic"`: this project has cacheComponents on, which
// rejects it, and reading the Authorization header already makes the route
// dynamic.
export const maxDuration = 60;

// A WHOOP pull takes a few seconds. A handful of athletes at a time keeps the
// run inside the time limit without sending WHOOP every request at once.
const CONCURRENCY = 4;

export async function GET(req: NextRequest) {
  // The GitHub Actions poller and pg_cron both send this secret. Without it the
  // route is public, and every call spends each athlete's WHOOP quota.
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const force = url.searchParams.get("force") === "1";
  const only = url.searchParams.get("user");

  try {
    // Inside the try on purpose: admin() throws when the service role key is
    // missing, and outside it that surfaces as a bare 500 with no body.
    const db = admin();

    const missing = ["SUPABASE_SERVICE_ROLE_KEY", "WHOOP_CLIENT_ID",
                     "WHOOP_CLIENT_SECRET", "RESEND_API_KEY"]
      .filter((k) => !process.env[k]);
    if (missing.length && !dry) {
      return NextResponse.json(
        { error: `missing environment variables: ${missing.join(", ")}` },
        { status: 500 });
    }

    // Everyone who has connected WHOOP. Their profile decides whether there is
    // enough to build a plan from.
    const { data: connections, error } = await retrying(() => {
      const query = db.from("whoop_tokens").select("user_id").not("user_id", "is", null);
      return only ? query.eq("user_id", only) : query;
    });
    if (error) throw new Error(`could not list WHOOP connections: ${error.message}`);
    const ids: string[] = (connections ?? []).map((c: { user_id: string }) => c.user_id);

    // One athlete's failure -- a revoked WHOOP grant, a rejected email -- must
    // not cost anyone else their morning, so each one is caught on its own.
    const results = await inBatches(ids, CONCURRENCY, (id) =>
      runMorning(db, id, { dry, force, origin: url.origin }).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[morning]", id, msg);
        return { user_id: id, sent: false, error: msg };
      }));

    return NextResponse.json({ athletes: ids.length, env_missing: missing, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[morning]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function inBatches<T, R>(xs: T[], size: number, fn: (x: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += size)
    out.push(...(await Promise.all(xs.slice(i, i + size).map(fn))));
  return out;
}

/**
 * GET /api/demo/reset
 *
 * Puts the demo account's plan back the way the seeder left it. A reviewer
 * signing in from a job application can change the plan -- that is most of
 * what there is to try -- so something has to undo it before the next one
 * arrives. pg_cron calls this nightly (db/migrations/005_demo_account.sql).
 *
 * Only the plan needs restoring: the logged sets, the daily decisions and the
 * WHOOP tokens are already beyond reach of any signed-in session.
 *
 * The pristine copy lives in demo_baseline, which no user policy can read, so
 * the session allowed to change the plan is not the one holding the original.
 */
import { NextRequest, NextResponse } from "next/server";

import { admin } from "@/lib/athlete/supabase";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  // Same secret as the morning poll. Without it anyone could discard whatever
  // a reviewer was in the middle of looking at.
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = admin();
  const { data: baselines, error } = await db
    .from("demo_baseline").select("user_id, config");
  if (error) {
    console.error("[demo/reset]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!baselines?.length) {
    // Not a failure: a deployment without a demo account simply has none.
    return NextResponse.json({ restored: 0, note: "no demo baseline saved" });
  }

  const restored: string[] = [];
  const failed: { user_id: string; error: string }[] = [];
  for (const { user_id, config } of baselines) {
    // The whole config, so a key the last visitor added goes away too, and
    // so the demo flag is re-asserted even if something dropped it.
    const { error: e } = await db.from("athlete_profile").upsert(
      { user_id, config, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (e) failed.push({ user_id, error: e.message });
    else restored.push(user_id);
  }
  if (failed.length) console.error("[demo/reset]", JSON.stringify(failed));

  return NextResponse.json({ restored: restored.length, failed });
}

/**
 * GET /api/demo/reset
 *
 * Rebuilds the demo account for today. pg_cron calls it nightly
 * (db/migrations/005_demo_account.sql).
 *
 * Two jobs in one. A reviewer signing in from a job application can change
 * the plan, so whatever the last one did has to be undone before the next
 * arrives. And the demo's history is dated back from the day it was built,
 * so without a rebuild it goes stale: a few days on, the "latest" morning
 * decision is days old and the last logged session a week gone. Rebuilding
 * from lib/athlete/demo-seed.ts each night fixes both, the same way the seed
 * script builds it.
 *
 * Which accounts are demos is read from demo_baseline, which no user policy
 * can reach, so the session allowed to change the plan cannot change the list.
 */
import { NextRequest, NextResponse } from "next/server";

import { admin } from "@/lib/athlete/supabase";
import { writeDemo } from "@/lib/athlete/demo-seed";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  // Same secret as the morning poll. Without it anyone could discard whatever
  // a reviewer was in the middle of looking at.
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = admin();
  const { data: demos, error } = await db.from("demo_baseline").select("user_id");
  if (error) {
    console.error("[demo/reset]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!demos?.length) {
    // Not a failure: a deployment without a demo account simply has none.
    return NextResponse.json({ restored: 0, note: "no demo account registered" });
  }

  const rebuilt: { user_id: string; sets: number; decisions: number }[] = [];
  const failed: { user_id: string; error: string }[] = [];
  for (const { user_id } of demos) {
    try {
      const r = await writeDemo(db, user_id);
      rebuilt.push({ user_id, sets: r.sets, decisions: r.decisions });
    } catch (e) {
      failed.push({ user_id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (failed.length) console.error("[demo/reset]", JSON.stringify(failed));

  // `restored` kept as the count, so what the cron job logs reads the same.
  return NextResponse.json({ restored: rebuilt.length, rebuilt, failed });
}

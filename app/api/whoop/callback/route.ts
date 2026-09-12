/**
 * GET /api/whoop/callback -- where WHOOP sends the athlete back after approval.
 *
 * Checks the state against the cookie set by /api/whoop/connect, trades the
 * one-time code for the athlete's first token pair, and stores it against
 * their account. From then on only the morning job refreshes it.
 */
import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { connect, whoopRedirectUri, WHOOP_STATE_COOKIE } from "@/lib/athlete/whoop";
import { saveWhoopSummary } from "@/lib/athlete/summary";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const back = (outcome: string) => {
    const res = NextResponse.redirect(new URL(`/athlete?whoop=${outcome}`, req.url));
    res.cookies.set(WHOOP_STATE_COOKIE, "", { path: "/api/whoop", maxAge: 0 });
    return res;
  };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/auth/login", req.url));

  if (url.searchParams.get("error")) return back("denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = req.cookies.get(WHOOP_STATE_COOKIE)?.value;
  if (!code || !state || !expected || state !== expected) return back("state");

  try {
    const at = await connect(user.id, code, whoopRedirectUri(url.origin));
    // Read their history once now, so the setup page can show what each of
    // their sports costs them before the first morning email. A failure here
    // does not undo the connection; the morning job fills it in later.
    await saveWhoopSummary(user.id, at).catch((e) =>
      console.error("[whoop callback] summary:", e instanceof Error ? e.message : e));
    return back("connected");
  } catch (e) {
    console.error("[whoop callback]", e instanceof Error ? e.message : e);
    return back("failed");
  }
}

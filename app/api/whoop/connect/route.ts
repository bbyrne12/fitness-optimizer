/**
 * GET /api/whoop/connect -- send the signed-in athlete to WHOOP to approve access.
 *
 * The state value is WHOOP's required anti-forgery check (at least 8
 * characters) and ours: it goes out in the redirect and into a short-lived
 * httpOnly cookie, and the callback refuses any response whose state does not
 * match the cookie.
 */
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { demoAccount } from "@/lib/athlete/demo";
import { authorizeUrl, whoopRedirectUri, WHOOP_STATE_COOKIE } from "@/lib/athlete/whoop";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/auth/login", req.url));

  // The demo account is meant to hold invented data. Letting a reviewer
  // authorise their own WHOOP here would put a real person's recovery,
  // sleep and workouts behind a login that goes out in a job application.
  if (await demoAccount(supabase, user.id)) {
    return NextResponse.redirect(new URL("/athlete?whoop=demo", req.url));
  }

  if (!process.env.WHOOP_CLIENT_ID || !process.env.WHOOP_CLIENT_SECRET) {
    return NextResponse.redirect(new URL("/athlete?whoop=unavailable", req.url));
  }

  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(
    authorizeUrl(state, whoopRedirectUri(req.nextUrl.origin)),
  );
  res.cookies.set(WHOOP_STATE_COOKIE, state, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/whoop",
    maxAge: 600,
  });
  return res;
}

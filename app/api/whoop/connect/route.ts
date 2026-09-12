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
import { authorizeUrl, whoopRedirectUri, WHOOP_STATE_COOKIE } from "@/lib/athlete/whoop";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/auth/login", req.url));

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

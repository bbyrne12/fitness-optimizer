import { updateSession } from "@/lib/supabase/middleware";
import { type NextRequest } from "next/server";

// The name only: lib/athlete/demo-coach is server-only and not for the proxy.
const VISITOR_COOKIE = "fo_visitor";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);
  // An anonymous id for whoever opens the coach, set before their first
  // message so the demo can count each reviewer separately. Random, holds
  // nothing about them, and only the demo's budget ever reads it.
  if (request.nextUrl.pathname.startsWith("/coach") && !request.cookies.get(VISITOR_COOKIE)) {
    response.cookies.set(VISITOR_COOKIE, crypto.randomUUID(), {
      httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:",
      path: "/", maxAge: 60 * 60 * 24 * 30,
    });
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * - opengraph-image, twitter-image (link previews; a scraper has no
     *   session, and the redirect below would hand it a login page)
     * - manifest.webmanifest (fetched by the browser with no cookies when
     *   someone adds the site to a home screen, so the redirect below
     *   would hand it a login page instead of the icons)
     * - api/demo/reset (machine-called; same CRON_SECRET)
     * - api/morning (machine-called; it has no Supabase session, so the
     *   redirect below would hand the poller a login page. It does its own
     *   auth with CRON_SECRET. Only this one route is excluded, not all of
     *   /api, so everything else still requires a signed-in user.)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|opengraph-image|twitter-image|manifest.webmanifest|api/morning|api/demo/reset|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

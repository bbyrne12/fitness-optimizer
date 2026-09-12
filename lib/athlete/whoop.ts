/**
 * WHOOP v2 access, per athlete, with the token rotation handled correctly.
 *
 * WHOOP issues a new refresh token on every refresh and kills the old one the
 * instant the new pair is minted. So for any one athlete exactly one process
 * may refresh, and it must persist the new pair BEFORE using it. That process
 * is the morning route. The OAuth callback only ever stores an athlete's first
 * pair, and tokens are only ever touched with the service role key.
 */
import { admin } from "./supabase";

const AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const BASE = "https://api.prod.whoop.com/developer";
const UA = "athlete-os/1.0";

/** Must match the scopes enabled on the WHOOP app, or WHOOP rejects the request. */
const SCOPES =
  "read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement offline";

/** Set by /api/whoop/connect, checked by /api/whoop/callback. */
export const WHOOP_STATE_COOKIE = "whoop_oauth_state";

export type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

/** Where WHOOP sends an athlete back. Must be registered on the WHOOP app exactly. */
export function whoopRedirectUri(origin: string) {
  return process.env.WHOOP_REDIRECT_URI ?? `${origin}/api/whoop/callback`;
}

export function authorizeUrl(state: string, redirectUri: string) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: process.env.WHOOP_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
  });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: new URLSearchParams({
      ...params,
      client_id: process.env.WHOOP_CLIENT_ID!,
      client_secret: process.env.WHOOP_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) {
    throw new Error(`WHOOP ${params.grant_type} failed ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function persist(userId: string, t: TokenResponse) {
  // Without a refresh token the connection dies in an hour, silently.
  if (!t.refresh_token) {
    throw new Error("WHOOP returned no refresh token; the offline scope must be enabled on the app");
  }
  const expires_at = new Date(Date.now() + t.expires_in * 1000).toISOString();
  const { error } = await admin()
    .from("whoop_tokens")
    .upsert(
      {
        user_id: userId,
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  // A failed write here means the next run is locked out permanently, so this
  // must throw rather than continue with a token we did not save.
  if (error) throw new Error(`could not persist WHOOP tokens: ${error.message}`);
  return { ...t, expires_at } as Tokens;
}

/** First connection: trade the one-time code from WHOOP's redirect for a token pair. */
export async function connect(userId: string, code: string, redirectUri: string) {
  const t = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  return (await persist(userId, t)).access_token;
}

export async function accessToken(userId: string): Promise<string> {
  const { data, error } = await admin()
    .from("whoop_tokens")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("no WHOOP tokens stored for this athlete");

  // Two minutes of headroom so a slow request cannot expire mid-flight.
  if (new Date(data.expires_at).getTime() > Date.now() + 120_000) {
    return data.access_token;
  }

  const fresh = await persist(
    userId,
    await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
      scope: "offline",
    }),
  );
  return fresh.access_token;
}

/** Whether an athlete has WHOOP connected. Never hands back the tokens themselves. */
export async function connectionStatus(userId: string) {
  const { data } = await admin()
    .from("whoop_tokens")
    .select("updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    connected: Boolean(data),
    updatedAt: (data?.updated_at as string | undefined) ?? null,
  };
}

/** Forgets the athlete's tokens. Nothing is read from WHOOP again until they reconnect. */
export async function disconnect(userId: string) {
  const { error } = await admin().from("whoop_tokens").delete().eq("user_id", userId);
  if (error) throw new Error(`could not disconnect WHOOP: ${error.message}`);
}

async function get(path: string, at: string) {
  const res = await fetch(BASE + path, {
    headers: { Authorization: `Bearer ${at}`, "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`WHOOP GET ${path} -> ${res.status}`);
  return res.json();
}

/** Paged collection read. WHOOP caps a page at 25, so this is always a loop. */
async function page(path: string, at: string, cap = 400) {
  const out: Record<string, unknown>[] = [];
  let token: string | undefined;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}limit=25${token ? `&nextToken=${token}` : ""}`;
    const d = await get(url, at);
    out.push(...(d.records ?? []));
    token = d.next_token;
    if (!token || out.length >= cap) return out;
  }
}

/**
 * Recovery and workouts as far back as WHOOP has them (up to about two years),
 * for measuring what each sport costs. It is dozens of requests, one page at a
 * time so as not to trip WHOOP's rate limit, so it runs once, on connecting.
 */
export async function pullHistory(at: string) {
  const recovery = await page("/v2/recovery", at, 750);
  const workouts = await page("/v2/activity/workout", at, 750);
  return { recovery, workouts };
}

/** Height, weight and max heart rate, as WHOOP has them. */
export async function body(at: string) {
  return get("/v2/user/measurement/body", at) as Promise<{ max_heart_rate?: number }>;
}

/** Only what the decision needs: ~90 days is plenty for 30-day baselines. */
export async function pull(at: string) {
  const [recovery, cycles, sleep, workouts] = await Promise.all([
    page("/v2/recovery", at, 120),
    page("/v2/cycle", at, 120),
    page("/v2/activity/sleep", at, 120),
    page("/v2/activity/workout", at, 200),
  ]);
  return { recovery, cycles, sleep, workouts };
}

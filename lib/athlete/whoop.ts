/**
 * WHOOP v2 access, with the token rotation handled correctly.
 *
 * WHOOP issues a new refresh token on every refresh and kills the old one the
 * instant the new pair is minted. So: exactly one process may refresh, and it
 * must persist the new pair BEFORE using it. That process is this route.
 */
import { admin } from "./supabase";

const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const BASE = "https://api.prod.whoop.com/developer";
const UA = "athlete-os/1.0";

export type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

async function persist(t: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}) {
  const expires_at = new Date(Date.now() + t.expires_in * 1000).toISOString();
  const { error } = await admin()
    .from("whoop_tokens")
    .upsert({
      id: "singleton",
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at,
      updated_at: new Date().toISOString(),
    });
  // A failed write here means the next run is locked out permanently, so this
  // must throw rather than continue with a token we did not save.
  if (error) throw new Error(`could not persist WHOOP tokens: ${error.message}`);
  return { ...t, expires_at } as Tokens;
}

export async function accessToken(): Promise<string> {
  const { data, error } = await admin()
    .from("whoop_tokens")
    .select("*")
    .eq("id", "singleton")
    .single();
  if (error || !data) throw new Error("no WHOOP tokens stored");

  // Two minutes of headroom so a slow request cannot expire mid-flight.
  if (new Date(data.expires_at).getTime() > Date.now() + 120_000) {
    return data.access_token;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: data.refresh_token,
    client_id: process.env.WHOOP_CLIENT_ID!,
    client_secret: process.env.WHOOP_CLIENT_SECRET!,
    scope: "offline",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body,
  });
  if (!res.ok) throw new Error(`WHOOP refresh failed ${res.status}: ${await res.text()}`);
  const fresh = await persist(await res.json());
  return fresh.access_token;
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

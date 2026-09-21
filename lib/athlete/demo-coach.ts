import "server-only";
import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";

import { admin } from "@/lib/athlete/supabase";
import type { DemoLimit } from "@/app/coach/demo-content";

/**
 * The demo coach's budget. Every reviewer is the same demo athlete, so the
 * per-athlete cap would be shared by all of them: one heavy visitor would
 * spend it and the coach would be broken for the next. Instead the demo gets
 * its own day's budget, apart from real athletes, split by visitor.
 *
 * Counting happens in Postgres (db/migrations/006_demo_coach_budget.sql), in
 * one transaction per message, so two tabs cannot both take the last one.
 */

/** Dollars a day for every demo visitor together. Real athletes have their
 *  own caps and never draw on this. */
export const DEMO_DAILY_USD = Number(process.env.COACH_DEMO_DAILY_USD ?? 3);
/** Messages a day for one visitor. */
export const DEMO_VISITOR_MESSAGES = 10;
/** Messages a day from one network, for anyone clearing cookies to start
 *  over: three visitors' worth, so reviewers sharing an office still fit. */
export const DEMO_NETWORK_MESSAGES = 30;
/** Athlete messages in one demo conversation. */
export const DEMO_MAX_TURNS = 6;
/** Output tokens per demo request: enough for the coach's two to four
 *  sentences, not for an essay. */
export const DEMO_MAX_TOKENS = 450;
/** Tool rounds per demo message: one change, then the reply. */
export const DEMO_MAX_ROUNDS = 1;

export const VISITOR_COOKIE = "fo_visitor";

export type VisitorKeys = { visitor: string; network: string | null };

const hashed = (s: string) =>
  createHash("sha256").update(`${process.env.CRON_SECRET ?? "fo"}:${s}`).digest("hex").slice(0, 20);

/** Who is asking: their anonymous cookie, or their network when no cookie
 *  came with the request. Raw addresses are hashed before they go anywhere. */
export async function visitorKeys(): Promise<VisitorKeys> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim();
  const network = ip ? `ip:${hashed(ip)}` : null;
  const id = (await cookies()).get(VISITOR_COOKIE)?.value;
  const visitor = id && /^[0-9a-f-]{16,64}$/i.test(id) ? `v:${id}` : network ?? "ip:unknown";
  return { visitor, network };
}

/** Take one message for this visitor, or name the limit that stops it. */
export async function takeDemoMessage(day: string, keys: VisitorKeys): Promise<"ok" | Exclude<DemoLimit, "turns">> {
  const { data, error } = await admin().rpc("demo_coach_take", {
    p_day: day, p_visitor: keys.visitor, p_network: keys.network,
    p_visitor_max: DEMO_VISITOR_MESSAGES, p_network_max: DEMO_NETWORK_MESSAGES, p_budget: DEMO_DAILY_USD,
  });
  if (error) {
    // Closed rather than open: an uncounted demo is the one thing this exists
    // to prevent. The reviewer still gets the friendly page, not an error.
    console.error("[demo-coach] take:", error.message);
    return "budget";
  }
  return data as "ok" | "budget" | "visitor" | "network";
}

/** Add what a message cost; say so in the logs when the day crosses 80%. */
export async function spendDemo(day: string, keys: VisitorKeys, usd: number): Promise<void> {
  const { data: crossed, error } = await admin().rpc("demo_coach_spend", {
    p_day: day, p_visitor: keys.visitor, p_usd: Math.round(usd * 10000) / 10000, p_budget: DEMO_DAILY_USD,
  });
  if (error) console.error("[demo-coach] spend:", error.message);
  else if (crossed) {
    // Also recorded as warned_at on the day's total row, since function logs
    // do not keep for long.
    console.warn(`[demo-coach] budget past 80% for ${day}: $${(0.8 * DEMO_DAILY_USD).toFixed(2)} of ` +
      `$${DEMO_DAILY_USD.toFixed(2)} spent. Latest visitor ${keys.visitor.slice(0, 12)}.`);
  }
}

/** The parts of the plan an answer depends on. Counters and bookkeeping
 *  written each turn are left out, or no answer would ever be reused. */
export function planHash(cfg: Record<string, unknown>): string {
  const { coach_usage, recheck, updated_at, ...plan } = cfg as Record<string, unknown>;
  void coach_usage; void recheck; void updated_at;
  const stable = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as any)[k])]))
      : v;
  return createHash("sha256").update(JSON.stringify(stable(plan))).digest("hex").slice(0, 24);
}

export async function cachedReply(day: string, prompt: string, hash: string): Promise<string | null> {
  const { data, error } = await admin().from("demo_coach_cache")
    .select("reply").eq("day", day).eq("prompt", prompt).eq("plan_hash", hash).maybeSingle();
  if (error) console.error("[demo-coach] cache read:", error.message);
  return (data?.reply as string | undefined) ?? null;
}

export async function cacheReply(day: string, prompt: string, hash: string, reply: string): Promise<void> {
  const { error } = await admin().from("demo_coach_cache")
    .upsert({ day, prompt, plan_hash: hash, reply }, { onConflict: "day,prompt,plan_hash", ignoreDuplicates: true });
  if (error) console.error("[demo-coach] cache write:", error.message);
}

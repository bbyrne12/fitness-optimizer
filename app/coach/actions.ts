"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { admin, retrying } from "@/lib/athlete/supabase";
import { applyPlanPatch, GOALS, type PlanPatch } from "@/lib/athlete/plan-patch";
import { readNotes } from "@/lib/athlete/notes";
import { planInputs, weekTemplate, kindLabel, FOCUS_MUSCLES, RACE_DISTANCES } from "@/lib/athlete/decide";
import { runMorning } from "@/lib/athlete/run-morning";
import { isDemo } from "@/lib/athlete/demo";
import {
  cacheReply, cachedReply, planHash, spendDemo, takeDemoMessage, visitorKeys,
  DEMO_MAX_ROUNDS, DEMO_MAX_TOKENS, DEMO_MAX_TURNS, type VisitorKeys,
} from "@/lib/athlete/demo-coach";
import { DEMO_STARTERS, type DemoLimit } from "./demo-content";

export type ChatMessage = { role: "user" | "assistant"; content: string };
// `limited` is the demo's way of saying no: never an error, always a page
// that still shows what the coach does. Real athletes get `error`.
export type CoachReply = { reply: string; applied: string[]; error?: string; limited?: DemoLimit };

// The coach runs on the app's one API key, so what it may spend is capped
// here as well as in the Console: dollars per athlete per day, and dollars
// for everyone together per day. Kept low for the demo; raise with the
// environment. Sonnet 5 keeps a turn around a cent.
const MODEL = process.env.COACH_MODEL ?? "claude-sonnet-5";
const USER_DAILY_USD = Number(process.env.COACH_USER_DAILY_USD ?? 0.25);
const ALL_DAILY_USD = Number(process.env.COACH_DAILY_USD ?? 2);
// Dollars per million tokens: input, output. Cache reads bill at a tenth of
// input and cache writes at 1.25x.
const PRICES: Record<string, [number, number]> = {
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
  "claude-opus-5": [5, 25],
};
const LIMIT_MESSAGE = "You've reached your daily spend limit for the coach. It resets tomorrow; the Setup page still edits everything directly.";
const HISTORY = 20;
const MAX_ROUNDS = 3;

const TOOL: Anthropic.Tool = {
  name: "update_plan",
  description:
    "Change the athlete's plan settings. Only include the fields being changed. " +
    "Use it when the athlete asks for a change or has clearly agreed to one you proposed; never for a question.",
  input_schema: {
    type: "object",
    properties: {
      goals: { type: "array", items: { type: "string", enum: [...GOALS] },
        description: "The full list of goals after the change." },
      race: { type: ["object", "null"],
        description: "The race being trained for, or null to remove it.",
        properties: {
          distance: { type: "string", enum: Object.keys(RACE_DISTANCES) },
          date: { type: "string", description: "YYYY-MM-DD" },
          name: { type: "string" } },
        required: ["distance", "date"] },
      week: { type: "object", properties: {
        lift_days: { type: "integer", minimum: 0, maximum: 5 },
        run_days: { type: "integer", minimum: 0, maximum: 5 },
        long_run_day: { type: "string", enum: ["Sat", "Sun"] } } },
      activities: { type: "array",
        description: "The full list of sports/practices after the change, replacing the old list.",
        items: { type: "object", properties: {
          sport: { type: "string", description: "WHOOP's name for it, lowercase: lacrosse, tennis, basketball, soccer, cycling, swimming, hiking, golf, skiing, climbing, boxing, functional fitness. Keep an existing sport's name unchanged." },
          label: { type: "string" },
          days: { type: "array", items: { type: "string", enum: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] } },
          time: { type: ["string", "null"], description: "24h start time like 18:00, or null" },
          intensity: { type: "string", enum: ["easy", "moderate", "hard"] } },
          required: ["days"] } },
      zone2_ceiling_bpm: { type: "integer" },
      longest_run_mi: { type: "number" },
      focus_muscles: { type: "array", items: { type: "string", enum: [...FOCUS_MUSCLES] },
        description: "The full list after the change." },
      notes: { type: "string", description: "The athlete's notes, in full, after the change. Preserve what is there and add to it; do not drop anything they wrote." },
      manual_lifts: { type: "array", items: { type: "string" },
        description: "Lowercase fragments of lift names held at their current weight (injury, rehab). The full list after the change." },
      cues: { type: "object", additionalProperties: { type: "string" },
        description: "One-line reminders per session type: push, pull, legs, upper, full body, long run, run. Empty string removes one." },
      email_daily: { type: "boolean" },
      email_to: { type: ["string", "null"] },
      morning_not_before: { type: ["string", "null"],
        description: "Earliest local time the morning decision may be sent, like \"07:30\", or null for as soon as WHOOP scores them. Use when they are being emailed too early. Midday at the latest." },
    },
  },
};

/** Rechecks a day at most this many times, so a WHOOP pull and an email are
 *  not something a conversation can spend without limit. */
const RECHECKS_PER_DAY = 3;

const RECHECK: Anthropic.Tool = {
  name: "recheck_morning",
  description:
    "Read the athlete's WHOOP again and redo today's decision from scratch: the week, what has actually been trained, any missed lift to carry forward, and the recovery WHOOP has now. It replaces the decision already made and sends it again if they have the morning email on. " +
    "Use it whenever they ask for today to be redone or changed, say this morning's numbers are wrong or out of date, or say the decision was made before something they did or did not do -- including a session they skipped or did late. " +
    "Only after they ask; it costs them a WHOOP read and an email.",
  input_schema: { type: "object", properties: {} },
};

// Fixed for every athlete and every turn, so it is cached; the athlete's own
// context follows it as a second block.
const INSTRUCTIONS = `You are the coach inside Fitness Optimizer, a training app. Every morning the app reads the athlete's WHOOP recovery and decides what they train that day: the session, how hard, and at what loads. It plans the week from the athlete's settings and prices each kind of day from the athlete's own recovery history.

You help the athlete adjust their plan in conversation, the way they would with a coach: change training days, add or move a sport, set a race, note an injury, change goals, or explain why the plan does what it does.

How the plan works, so you can explain it:
- Goals: hrv (raise HRV and recovery; slow breathing is added when HRV dips), race (a build to a race date, long run on the chosen weekend day), strength (loads progress after two clean sessions instead of three), general.
- What the day is and how hard it is are two different things. The session comes from the week and from what has actually been trained; recovery decides how much of it to do. Never tell the athlete their session is set by recovery alone.
- A missed lift is carried: on a lift day the app looks back four days for a lift that was scheduled and did not happen, and moves it into today, with the rest of the week shifting behind it. A day with a run or a match on it counts as a trade, not a miss; a lift made up since is not owed twice; a day WHOOP never scored is left alone. So resting on Saturday when push was due means push on the next lift day, not legs.
- Week: activities are placed on their days first; the long run on Sat or Sun with a rest day after; lifts fill the remaining days by split (1 full body, 2 legs/upper, 3 legs/pull/push, 4 adds legs, 5 adds upper); runs stack onto pull or upper days when there is no free day.
- Each morning: green and red are this athlete's own lines, not WHOOP's 67 and 34. They are learned from the athlete's own spread of mornings and then moved by how much a day started low costs them; their current lines are in the context as recovery_lines. Between the lines the session scales with the number itself, so a 62% day keeps more of the plan than a 45% one. Sleep debt, an HRV streak below their band, and resting heart rate over baseline can push the day down. Below the lower line is rest.
- The morning decision is made from the first recovery WHOOP scores, which lands shortly after they wake. A short night that they might still be in is held back until it looks whole, and sent by early afternoon at the latest. If they say the email came before they had finished sleeping, or that its sleep and recovery are wrong, use recheck_morning to redo the day from WHOOP as it stands now, and offer to set an earliest time with morning_not_before so it cannot happen again.
- Learned costs: next-morning recovery points each kind of day costs this athlete against a rest day, with that night's sleep held equal, fit on their whole WHOOP history. Blended toward a default until there are at least five measured days. Runs are bucketed by the athlete's own heart-rate zones (zone 2, long, hard), never by duration. Alcohol, illness and stress are not in the data, so a number is an estimate, and the athlete should not over-read small differences.
- Reading those numbers: they are negative, and the more negative one is the bigger cost. -8.1 costs more than -7.4. Rank by size before calling anything the most or least expensive, and check what you say against the number you quote. A weekly total is the cost times the days it is done, which can outrank a dearer session done once.
- Loads come from the athlete's own log: the last session of that kind, with a bump once the same load has been done cleanly enough times, except lifts held at current weight.
- Notes are read into structured fields (held lifts, per-session reminders) when they change.

What you can see, in the athlete's context below:
- recent_days: the last three weeks, one entry per day. "trained" is what WHOOP recorded that day (sports, runs by heart-rate bucket) plus the lift kind from their log; "lifts" is what they actually logged, at their loads; "recovery" and "call" are that morning's decision. Answer questions about what they did from this, rather than saying you cannot see it.
- Freshness: WHOOP sessions are read each morning, so today's entry usually only covers what happened before this morning. A session later today appears tomorrow. Say that rather than saying it did not happen.
- A day with nothing recorded is a rest day as far as the data goes, but a workout the watch missed is possible; if they say they did something, believe them.

Rules:
- Make a change only when the athlete asks for it or clearly agrees to one you proposed. Use the update_plan tool for every change, with only the fields that change. Never describe a change as made without calling the tool.
- Keep the full lists when editing a list field: to add a sport, send the existing activities plus the new one.
- Be brief and concrete. Two to four sentences unless they ask for more. No headers, no bullet lists longer than four items.
- Write the finished answer. Never think aloud, never correct yourself mid-sentence, and never show a dead end you have already rejected.
- Talk about the plan in the athlete's words -- their long run day, their lift days, the morning email -- never the field names this app stores them under.
- When what they ask for does not match what is scheduled, say in one sentence what is actually on that day, then offer the nearest change you can make and ask one short question. Do not list several readings of what they might have meant.
- Say plainly when something is outside what the plan can do, and offer the nearest thing it can.
- Never invent an injury, result or number. If you do not know, say so.
- Do not give medical advice beyond training adjustments; a persistent injury is a reason to see a clinician.
- When they ask for today to be redone, or say the decision was made before or without something they did, call recheck_morning. Do not reason about whether it would come out the same: it reads WHOOP again and rebuilds the day from the plan as it now stands, which is not something you can predict from the context. Never answer that there is nothing to redo.
- If the context says demo_account, this is a sample athlete whose data is invented. Plan changes are saved and work exactly as they do for anyone else, so make them without comment; the account is put back overnight, which is not worth mentioning unless asked. Two things it cannot do: change the training log, and redo today's decision, because the demo has no WHOOP connected. Say that plainly in one sentence if either comes up.`;

/**
 * Redo today's decision from WHOOP as it stands now. The morning poll takes
 * the first recovery WHOOP scores, which on a broken night is scored before
 * the night is over; this is the athlete saying "look again", so it runs the
 * same code the scheduler runs, with today's row replaced rather than kept.
 *
 * Capped per day: it spends a WHOOP read and an email every time.
 */
async function recheck(userId: string, cfg: Record<string, any>,
                       keep: (c: Record<string, any>) => void, applied: string[]):
    Promise<{ content: string; is_error?: boolean }> {
  const day = today();
  const used = cfg.recheck?.day === day ? Number(cfg.recheck.count ?? 0) : 0;
  if (used >= RECHECKS_PER_DAY)
    return { is_error: true, content: `Already rechecked ${used} times today, which is the limit. It will be right again tomorrow morning.` };

  const db = admin();
  // Counted before the run, not after: a run that fails halfway still spent
  // the WHOOP read.
  await retrying(() => db.from("athlete_profile")
    .update({ config: { ...cfg, recheck: { day, count: used + 1 } } }).eq("user_id", userId));

  const host = (await headers()).get("host");
  const origin = process.env.NEXT_PUBLIC_SITE_URL
    ?? (host ? `https://${host}` : "https://fitness-optimizer.vercel.app");
  let out: Record<string, any>;
  try {
    out = await runMorning(db, userId, { dry: false, force: true, origin }) as Record<string, any>;
  } catch (e) {
    return { is_error: true, content: `Could not reach WHOOP just now: ${e instanceof Error ? e.message : String(e)}` };
  }

  // runMorning writes the profile itself (the day's learning, the time zone),
  // so what is held here is stale until it is read back.
  const { data: fresh } = await retrying(() => db.from("athlete_profile")
    .select("config").eq("user_id", userId).maybeSingle());
  if (fresh?.config) keep(fresh.config as Record<string, any>);

  const { data: row } = await retrying(() => db.from("decision_log")
    .select("day,decision").eq("user_id", userId).eq("day", String(out.day ?? day)).maybeSingle());
  const dec = (row?.decision ?? {}) as Record<string, any>;
  if (out.waiting)
    return { content: JSON.stringify({ redone: false, waiting: true, reason: out.reason ?? out.expecting }) };

  applied.push(out.sent ? "Today's decision redone and re-sent" : "Today's decision redone");
  return { content: JSON.stringify({
    redone: true, emailed: Boolean(out.sent), day: out.day,
    recovery: dec.state?.recovery, sleep_h: dec.state?.sleep_hours,
    level: dec.decision?.level, call: dec.decision?.call,
    reasons: dec.decision?.reasons,
  }) };
}

type Usage = { day: string; messages: number; input_tokens: number; output_tokens: number; usd: number };

const today = () => new Date().toISOString().slice(0, 10);

function usageOf(cfg: Record<string, any>): Usage {
  const u = cfg.coach_usage as Usage | undefined;
  return u && u.day === today()
    ? { ...u, usd: u.usd ?? 0 }
    : { day: today(), messages: 0, input_tokens: 0, output_tokens: 0, usd: 0 };
}

/** Real athletes' coach spend today, in dollars, for the shared cap. The demo
 *  is left out: it has a budget of its own, so reviewers cannot use up the
 *  coach for the people actually training with it. */
async function spentToday(): Promise<number> {
  const { data } = await retrying(() => admin().from("athlete_profile")
    .select("config->coach_usage, config->demo"));
  const d = today();
  return (data ?? []).reduce((n: number, r: any) => {
    if (r.demo === true) return n;
    const u = r.coach_usage as Usage | null;
    return n + (u && u.day === d ? u.usd ?? 0 : 0);
  }, 0);
}

export async function coach(history: ChatMessage[], message: string): Promise<CoachReply> {
  const text = message.trim().slice(0, 2000);
  if (!text) return { reply: "", applied: [], error: "Say something first." };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { reply: "", applied: [], error: "The coach is not set up on this deployment." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { reply: "", applied: [], error: "Sign in first." };

  const { data: prof } = await supabase
    .from("athlete_profile").select("config").eq("user_id", user.id).maybeSingle();
  let cfg = (prof?.config ?? {}) as Record<string, any>;

  // The athlete's own local day, so "yesterday" means theirs.
  const shiftDay = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
  const localToday = new Date(Date.now() + Number(cfg.utc_offset_minutes ?? 0) * 60_000)
    .toISOString().slice(0, 10);

  // Spend guards, before anything is sent. The demo's are its own: one budget
  // for every reviewer, split between them, and never an error when it runs
  // out. A suggested prompt already answered today is free, so it is served
  // before any limit is looked at.
  const demo = isDemo(cfg);
  const starter = demo && history.length === 0 && DEMO_STARTERS.includes(text);
  const hash = starter ? planHash(cfg) : "";
  let keys: VisitorKeys | null = null;
  const usage = usageOf(cfg);
  if (demo) {
    if (starter) {
      const hit = await cachedReply(localToday, text, hash);
      if (hit) return { reply: hit, applied: [] };
    }
    if (history.filter((m) => m.role === "user").length >= DEMO_MAX_TURNS)
      return { reply: "", applied: [], limited: "turns" };
    keys = await visitorKeys();
    const verdict = await takeDemoMessage(today(), keys);
    if (verdict !== "ok") return { reply: "", applied: [], limited: verdict };
  } else if (usage.usd >= USER_DAILY_USD || (await spentToday()) >= ALL_DAILY_USD) {
    return { reply: "", applied: [], error: LIMIT_MESSAGE };
  }
  const RECENT_DAYS = 21;
  const from = shiftDay(localToday, -RECENT_DAYS);

  const [{ data: latest }, { data: recentDecisions }, { data: recentSets }] = await Promise.all([
    supabase.from("decision_log").select("day,decision").eq("user_id", user.id)
      .order("day", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("decision_log")
      .select("day,decision->state->recovery,decision->state->sleep_hours,decision->decision->level,decision->decision->call")
      .eq("user_id", user.id).gte("day", from).order("day", { ascending: false }),
    supabase.from("athlete_sets").select("day,exercise,weight,reps,sets,pin")
      .eq("user_id", user.id).gte("day", from).order("day", { ascending: false }).limit(400),
  ]);

  // What the athlete actually did, day by day: WHOOP's sessions from the
  // learned history, their own logged lifts, and that morning's decision.
  const recentDays = () => {
    const kinds = (cfg.learned?.days ?? {}) as Record<string, { kind?: string }>;
    const morning = new Map((recentDecisions ?? []).map((d: any) => [d.day, d]));
    const lifts: Record<string, string[]> = {};
    for (const r of recentSets ?? []) {
      const load = r.weight ? ` @ ${r.weight}` : r.pin ? ` ${r.pin}` : "";
      (lifts[r.day] ??= []).push(`${r.exercise} ${r.sets} x ${r.reps ?? "-"}${load}`);
    }
    const out = [];
    for (let i = 0; i <= RECENT_DAYS; i++) {
      const date = shiftDay(localToday, -i);
      const kind = kinds[date]?.kind;
      const m = morning.get(date) as any;
      if (!kind && !lifts[date] && !m) continue;
      out.push({
        date,
        day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(date + "T12:00:00Z").getUTCDay()],
        trained: kind ? kindLabel(kind) : "nothing recorded",
        lifts: lifts[date],
        recovery: m?.recovery != null ? Math.round(m.recovery) : undefined,
        sleep_h: m?.sleep_hours,
        call: m?.call,
      });
    }
    return out;
  };

  const context = () => {
    const inputs = planInputs(cfg);
    const learned = Object.entries((cfg.learned?.costs ?? {}) as Record<string, { value: number; n: number }>)
      .filter(([, c]) => c.n >= 1)
      .map(([k, c]) => ({ day: kindLabel(k), cost_vs_rest_day: c.value, measured_days: c.n }));
    const dec = (latest?.decision ?? {}) as Record<string, any>;
    return "The athlete's plan, what they have actually trained lately, and this morning's decision:\n" + JSON.stringify({
      plan: {
        goals: inputs.goals, race: inputs.race,
        week: { lift_days: inputs.liftDays, run_days: inputs.runDays, long_run_day: inputs.longRunDay },
        activities: inputs.activities, zone2_ceiling_bpm: inputs.zone2, longest_run_mi: inputs.longestRunMi,
        focus_muscles: cfg.focus_muscles ?? [], notes: cfg.notes ?? null,
        manual_lifts: cfg.manual_lifts ?? [], cues: cfg.cues ?? {},
        email_daily: cfg.email_daily !== false, email_to: cfg.email_to ?? null,
        morning_not_before: cfg.morning_not_before ?? null,
      },
      recovery_lines: dec.decision?.bands
        ? { green: dec.decision.bands.green, red: dec.decision.bands.red,
            mornings_behind_them: dec.decision.bands.n, source: dec.decision.bands.source }
        : null,
      demo_account: isDemo(cfg) || undefined,
      week_template: weekTemplate(inputs),
      learned_costs: learned,
      today: localToday,
      recent_days: recentDays(),
      latest_decision: latest ? { day: latest.day, level: dec.decision?.level, call: dec.decision?.call,
        detail: dec.decision?.detail, reasons: dec.decision?.reasons, session: dec.session?.items } : null,
    }, null, 1);
  };
  const system = (): Anthropic.TextBlockParam[] => [
    { type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } },
    { type: "text", text: context() },
  ];

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-(demo ? DEMO_MAX_TURNS * 2 : HISTORY)).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: text },
  ];
  const applied: string[] = [];
  let inTok = 0, outTok = 0, usd = 0;
  const [pin, pout] = PRICES[MODEL] ?? PRICES["claude-sonnet-5"];
  const account = (res: Anthropic.Message) => {
    const u = res.usage;
    const read = u.cache_read_input_tokens ?? 0, write = u.cache_creation_input_tokens ?? 0;
    inTok += u.input_tokens + read + write;
    outTok += u.output_tokens;
    usd += (u.input_tokens * pin + read * pin * 0.1 + write * pin * 1.25 + u.output_tokens * pout) / 1e6;
  };
  const ask = (maxTokens: number) => client.messages.create({
    model: MODEL, max_tokens: demo ? Math.min(maxTokens, DEMO_MAX_TOKENS) : maxTokens,
    // A chat turn does not need deep deliberation; low effort keeps it cheap and quick.
    output_config: { effort: "low" },
    system: system(), tools: [TOOL, RECHECK], messages,
  });

  try {
    let res = await ask(1200);
    account(res);

    // One round of tool use is enough for a plan change; the next call lets
    // the coach say what it did, with the result of applying it in hand.
    let usedTools = false;
    for (let round = 0; round < (demo ? DEMO_MAX_ROUNDS : MAX_ROUNDS) && res.stop_reason === "tool_use"; round++) {
      usedTools = true;
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        if (block.name === RECHECK.name && isDemo(cfg)) {
          // Nothing to reread: the demo has no WHOOP account behind it.
          results.push({ type: "tool_result", tool_use_id: block.id,
            content: JSON.stringify({ redone: false, demo: true, why: "no WHOOP connected" }) });
          continue;
        }
        if (block.name === RECHECK.name) {
          results.push({ type: "tool_result", tool_use_id: block.id,
            ...(await recheck(user.id, cfg, (c) => { cfg = c; }, applied)) });
          continue;
        }
        const patch = block.input as PlanPatch;
        const out = applyPlanPatch(cfg, patch);
        let config = out.config;
        // Changed notes are re-read into what the engine acts on, as the form does.
        if (patch.notes !== undefined && (config.notes ?? "") !== (cfg.notes ?? "")) {
          try {
            const read = config.notes ? await readNotes(config.notes) : null;
            config = { ...config, notes_read: read };
            if (read) config.manual_lifts = patch.manual_lifts !== undefined ? config.manual_lifts : read.manual_lifts;
          } catch (e) { console.error("[coach] readNotes:", e instanceof Error ? e.message : e); }
        }
        const { error } = await supabase.from("athlete_profile").upsert(
          { user_id: user.id, config, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
        if (error) {
          results.push({ type: "tool_result", tool_use_id: block.id, is_error: true,
            content: `Could not save: ${error.message}` });
          continue;
        }
        cfg = config;
        applied.push(...out.applied);
        results.push({ type: "tool_result", tool_use_id: block.id,
          content: JSON.stringify({ applied: out.applied, rejected: out.rejected }) });
      }
      messages.push({ role: "assistant", content: res.content });
      messages.push({ role: "user", content: results });
      res = await ask(800);
      account(res);
    }

    const reply = res.stop_reason === "refusal"
      ? "I can't help with that one. Anything about your training plan, ask away."
      : res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();

    if (demo) {
      await spendDemo(today(), keys!, usd);
      // Only a plain answer is reused: a reply that changed the plan would,
      // replayed, claim a change that was never made for the next visitor.
      if (starter && reply && !usedTools && res.stop_reason === "end_turn")
        await cacheReply(localToday, text, hash, reply);
    } else {
      // What this turn cost, on the athlete's profile: the per-day guard
      // reads it. Written with the service role, which no policy can refuse.
      const next: Usage = { day: usage.day, messages: usage.messages + 1,
        input_tokens: usage.input_tokens + inTok, output_tokens: usage.output_tokens + outTok,
        usd: Math.round((usage.usd + usd) * 10000) / 10000 };
      await admin().from("athlete_profile").upsert(
        { user_id: user.id, config: { ...cfg, coach_usage: next }, updated_at: new Date().toISOString() },
        { onConflict: "user_id" });
    }

    if (applied.length) {
      revalidatePath("/athlete"); revalidatePath("/calendar"); revalidatePath("/protected"); revalidatePath("/coach");
    }
    return { reply: reply || (applied.length ? "Done." : "…"), applied };
  } catch (e) {
    console.error("[coach]", e instanceof Error ? e.message : e);
    if (demo && keys && usd > 0) await spendDemo(today(), keys, usd);
    // The account's own limits upstream (rate, or the Console's spend cap)
    // are limits too, and the demo never shows those as errors.
    if (demo && e instanceof Anthropic.APIError &&
        (e.status === 429 || /credit|spend|usage limit/i.test(e.message)))
      return { reply: "", applied, limited: "budget" };
    return { reply: "", applied, error: "The coach could not answer just now. Try again in a moment." };
  }
}

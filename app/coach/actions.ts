"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { admin, retrying } from "@/lib/athlete/supabase";
import { applyPlanPatch, GOALS, type PlanPatch } from "@/lib/athlete/plan-patch";
import { readNotes } from "@/lib/athlete/notes";
import { planInputs, weekTemplate, kindLabel, FOCUS_MUSCLES, RACE_DISTANCES } from "@/lib/athlete/decide";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type CoachReply = { reply: string; applied: string[]; error?: string };

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
    },
  },
};

// Fixed for every athlete and every turn, so it is cached; the athlete's own
// context follows it as a second block.
const INSTRUCTIONS = `You are the coach inside Fitness Optimizer, a training app. Every morning the app reads the athlete's WHOOP recovery and decides what they train that day: the session, how hard, and at what loads. It plans the week from the athlete's settings and prices each kind of day from the athlete's own recovery history.

You help the athlete adjust their plan in conversation, the way they would with a coach: change training days, add or move a sport, set a race, note an injury, change goals, or explain why the plan does what it does.

How the plan works, so you can explain it:
- Goals: hrv (raise HRV and recovery; slow breathing is added when HRV dips), race (a build to a race date, long run on the chosen weekend day), strength (loads progress after two clean sessions instead of three), general.
- Week: activities are placed on their days first; the long run on Sat or Sun with a rest day after; lifts fill the remaining days by split (1 full body, 2 legs/upper, 3 legs/pull/push, 4 adds legs, 5 adds upper); runs stack onto pull or upper days when there is no free day.
- Each morning: recovery 67%+ is green, under 34% is red, between is amber. Sleep debt, an HRV streak below the athlete's band, and resting heart rate over baseline can push it down. Amber holds weights; red is rest.
- Learned costs: next-morning recovery points each kind of day costs this athlete against a rest day, with that night's sleep held equal, fit on their whole WHOOP history. Negative is a cost. Blended toward a default until there are at least five measured days. Runs are bucketed by the athlete's own heart-rate zones (zone 2, long, hard), never by duration. Alcohol, illness and stress are not in the data, so a number is an estimate, and the athlete should not over-read small differences.
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
- Say plainly when something is outside what the plan can do, and offer the nearest thing it can.
- Never invent an injury, result or number. If you do not know, say so.
- Do not give medical advice beyond training adjustments; a persistent injury is a reason to see a clinician.`;

type Usage = { day: string; messages: number; input_tokens: number; output_tokens: number; usd: number };

const today = () => new Date().toISOString().slice(0, 10);

function usageOf(cfg: Record<string, any>): Usage {
  const u = cfg.coach_usage as Usage | undefined;
  return u && u.day === today()
    ? { ...u, usd: u.usd ?? 0 }
    : { day: today(), messages: 0, input_tokens: 0, output_tokens: 0, usd: 0 };
}

/** Everyone's coach spend today, in dollars, for the shared cap. */
async function spentToday(): Promise<number> {
  const { data } = await retrying(() => admin().from("athlete_profile").select("config->coach_usage"));
  const d = today();
  return (data ?? []).reduce((n: number, r: any) => {
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

  // Spend guards, before anything is sent.
  const usage = usageOf(cfg);
  if (usage.usd >= USER_DAILY_USD || (await spentToday()) >= ALL_DAILY_USD)
    return { reply: "", applied: [], error: LIMIT_MESSAGE };

  // The athlete's own local day, so "yesterday" means theirs.
  const shiftDay = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
  const localToday = new Date(Date.now() + Number(cfg.utc_offset_minutes ?? 0) * 60_000)
    .toISOString().slice(0, 10);
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
      },
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
    ...history.slice(-HISTORY).map((m) => ({ role: m.role, content: m.content })),
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
    model: MODEL, max_tokens: maxTokens,
    // A chat turn does not need deep deliberation; low effort keeps it cheap and quick.
    output_config: { effort: "low" },
    system: system(), tools: [TOOL], messages,
  });

  try {
    let res = await ask(1200);
    account(res);

    // One round of tool use is enough for a plan change; the next call lets
    // the coach say what it did, with the result of applying it in hand.
    for (let round = 0; round < MAX_ROUNDS && res.stop_reason === "tool_use"; round++) {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
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

    // What this turn cost, on the athlete's profile: the per-day guard reads it.
    const next: Usage = { day: usage.day, messages: usage.messages + 1,
      input_tokens: usage.input_tokens + inTok, output_tokens: usage.output_tokens + outTok,
      usd: Math.round((usage.usd + usd) * 10000) / 10000 };
    await supabase.from("athlete_profile").upsert(
      { user_id: user.id, config: { ...cfg, coach_usage: next }, updated_at: new Date().toISOString() },
      { onConflict: "user_id" });

    if (applied.length) {
      revalidatePath("/athlete"); revalidatePath("/calendar"); revalidatePath("/protected"); revalidatePath("/coach");
    }
    return { reply: reply || (applied.length ? "Done." : "…"), applied };
  } catch (e) {
    console.error("[coach]", e instanceof Error ? e.message : e);
    return { reply: "", applied, error: "The coach could not answer just now. Try again in a moment." };
  }
}

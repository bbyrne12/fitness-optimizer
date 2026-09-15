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
// here as well as in the Console. Per athlete per day, and for everyone
// together per day; both are messages, since a message is what a person
// experiences. Override with the environment.
const MODEL = process.env.COACH_MODEL ?? "claude-opus-5";
const USER_DAILY = Number(process.env.COACH_USER_DAILY_MESSAGES ?? 40);
const ALL_DAILY = Number(process.env.COACH_DAILY_MESSAGES ?? 300);
const HISTORY = 20;
const MAX_ROUNDS = 3;

const TOOL: Anthropic.Beta.BetaTool = {
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

Rules:
- Make a change only when the athlete asks for it or clearly agrees to one you proposed. Use the update_plan tool for every change, with only the fields that change. Never describe a change as made without calling the tool.
- Keep the full lists when editing a list field: to add a sport, send the existing activities plus the new one.
- Be brief and concrete. Two to four sentences unless they ask for more. No headers, no bullet lists longer than four items.
- Say plainly when something is outside what the plan can do, and offer the nearest thing it can.
- Never invent an injury, result or number. If you do not know, say so.
- Do not give medical advice beyond training adjustments; a persistent injury is a reason to see a clinician.`;

type Usage = { day: string; messages: number; input_tokens: number; output_tokens: number };

const today = () => new Date().toISOString().slice(0, 10);

function usageOf(cfg: Record<string, any>): Usage {
  const u = cfg.coach_usage as Usage | undefined;
  return u && u.day === today() ? u : { day: today(), messages: 0, input_tokens: 0, output_tokens: 0 };
}

/** Everyone's coach messages today, for the shared cap. */
async function messagesToday(): Promise<number> {
  const { data } = await retrying(() => admin().from("athlete_profile").select("config->coach_usage"));
  const d = today();
  return (data ?? []).reduce((n: number, r: any) => {
    const u = r.coach_usage as Usage | null;
    return n + (u && u.day === d ? u.messages : 0);
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
  if (usage.messages >= USER_DAILY)
    return { reply: "", applied: [], error: `That is today's limit of ${USER_DAILY} coach messages. It resets tomorrow; the Setup page edits everything directly.` };
  if ((await messagesToday()) >= ALL_DAILY)
    return { reply: "", applied: [], error: "The coach has reached its limit for today across everyone. Try tomorrow, or use the Setup page." };

  const { data: latest } = await supabase
    .from("decision_log").select("day,decision").eq("user_id", user.id)
    .order("day", { ascending: false }).limit(1).maybeSingle();

  const context = () => {
    const inputs = planInputs(cfg);
    const learned = Object.entries((cfg.learned?.costs ?? {}) as Record<string, { value: number; n: number }>)
      .filter(([, c]) => c.n >= 1)
      .map(([k, c]) => ({ day: kindLabel(k), cost_vs_rest_day: c.value, measured_days: c.n }));
    const dec = (latest?.decision ?? {}) as Record<string, any>;
    return "The athlete's current plan, week, learned costs and latest decision:\n" + JSON.stringify({
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
      latest_decision: latest ? { day: latest.day, level: dec.decision?.level, call: dec.decision?.call,
        detail: dec.decision?.detail, reasons: dec.decision?.reasons, session: dec.session?.items } : null,
    }, null, 1);
  };
  const system = (): Anthropic.Beta.BetaTextBlockParam[] => [
    { type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } },
    { type: "text", text: context() },
  ];

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.slice(-HISTORY).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: text },
  ];
  const applied: string[] = [];
  let inTok = 0, outTok = 0;
  const account = (res: Anthropic.Beta.BetaMessage) => {
    inTok += res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    outTok += res.usage.output_tokens;
  };
  const ask = (maxTokens: number) => client.beta.messages.create({
    model: MODEL, max_tokens: maxTokens,
    // A chat turn does not need deep deliberation; medium keeps replies quick.
    output_config: { effort: "medium" },
    // If a safety classifier declines a turn, the same request re-runs on the
    // fallback model inside the call rather than leaving the athlete with nothing.
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: "claude-opus-4-8" }],
    system: system(), tools: [TOOL], messages,
  });

  try {
    let res = await ask(1200);
    account(res);

    // One round of tool use is enough for a plan change; the next call lets
    // the coach say what it did, with the result of applying it in hand.
    for (let round = 0; round < MAX_ROUNDS && res.stop_reason === "tool_use"; round++) {
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
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
      : res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();

    // What this turn cost, on the athlete's profile: the per-day guard reads it.
    const next: Usage = { day: usage.day, messages: usage.messages + 1,
      input_tokens: usage.input_tokens + inTok, output_tokens: usage.output_tokens + outTok };
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

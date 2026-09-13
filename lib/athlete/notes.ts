import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * What the plan takes from an athlete's free-text notes. Read once, when the
 * notes are saved, and stored on the profile so the engine never sees prose --
 * only these fields, which it already knows how to act on.
 */
export type NotesRead = {
  /** Exercise-name fragments that must not get automatic weight increases. */
  manual_lifts: string[];
  /** One-line reminders for a session type, shown on that day. */
  cues: Partial<Record<"push" | "pull" | "legs" | "upper" | "full body" | "long run" | "run", string>>;
  /** What they are after, in a sentence. */
  summary: string | null;
  /** The decision they want the morning email to make, in their words. */
  morning_call: string | null;
  read_at: string;
};

const CUE_KEYS = ["push", "pull", "legs", "upper", "full body", "long run", "run"];

export async function readNotes(notes: string): Promise<NotesRead | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !notes.trim()) return null;

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 800,
    messages: [{
      role: "user",
      content: `An athlete wrote these notes for a training plan that decides each morning what they should train, based on their WHOOP recovery. Read them and return only what the plan can act on.

Notes:
"""
${notes.slice(0, 2000)}
"""

Return raw JSON, no markdown fences, shaped exactly:
{
  "manual_lifts": ["..."],
  "cues": {"push": "...", "pull": "...", "legs": "...", "upper": "...", "full body": "...", "long run": "...", "run": "..."},
  "summary": "...",
  "morning_call": "..."
}

Rules:
- manual_lifts: short lowercase fragments of exercise names that should stay at their current weight because of an injury, rehab or the athlete saying so ("bench", "overhead press"). Empty array if none.
- cues: a one-line reminder for a session type, only where the notes justify one (an injury that affects push days, a shin history that affects runs). Omit keys with nothing to say. Under 90 characters each, written to the athlete.
- summary: one sentence, what they want to be true and by when, if they said. null if the notes do not say.
- morning_call: the decision they want made for them each morning, in one line, or null.
- Never invent an injury, lift or goal that is not in the notes.`,
    }],
  });

  const block = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  const raw = (block?.text ?? "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const got = JSON.parse(fence ? fence[1].trim() : raw) as Record<string, any>;

  const cues: NotesRead["cues"] = {};
  for (const k of CUE_KEYS) {
    const v = got.cues?.[k];
    if (typeof v === "string" && v.trim()) (cues as any)[k] = v.trim().slice(0, 120);
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 240) : null);
  return {
    manual_lifts: (Array.isArray(got.manual_lifts) ? got.manual_lifts : [])
      .map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 20),
    cues,
    summary: str(got.summary),
    morning_call: str(got.morning_call),
    read_at: new Date().toISOString(),
  };
}

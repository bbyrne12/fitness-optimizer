/**
 * Turn whatever he typed into muscles the engine can count.
 *
 * His vocabulary is personal -- "Inner thigh", "Bulgarians", "Forward shoulder
 * extreme slows" -- and the library's is formal -- "Barbell Full Squat". The
 * resolver bridges them in four steps, cheapest first:
 *
 *   1. Aliases already resolved once and remembered (stored on the profile).
 *   2. His own Notes vocabulary, which is already mapped by hand.
 *   3. The exercise library, matched on a normalised name.
 *   4. Claude, for whatever is genuinely new -- once per name, ever.
 *
 * Step 4 is the only one that costs anything, and its answers are written back
 * so the same name never reaches it twice.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { musclesFor, canonical } from "./muscles";

export type Resolution = {
  primary_muscle: string;
  secondary_muscles: string[];
  exercise_id?: number | null;
  source: "alias" | "vocab" | "library" | "ai" | "unresolved";
};

export type AliasMap = Record<string, Resolution>;

export const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export async function resolveExercises(
  names: string[],
  db: SupabaseClient,
  existing: AliasMap,
): Promise<{ map: AliasMap; added: AliasMap }> {
  const map: AliasMap = { ...existing };
  const added: AliasMap = {};
  const todo: string[] = [];

  for (const raw of new Set(names.map(norm))) {
    if (!raw || map[raw]) continue;

    // 2. his own vocabulary -- already hand-mapped, no lookup needed
    if (canonical(raw)) {
      const ms = musclesFor(raw);
      const prim = ms.find(([, w]) => w === 1)?.[0];
      if (prim) {
        const r: Resolution = {
          primary_muscle: prim,
          secondary_muscles: ms.filter(([, w]) => w < 1).map(([m]) => m),
          source: "vocab",
        };
        map[raw] = r; added[raw] = r;
        continue;
      }
    }
    todo.push(raw);
  }

  if (!todo.length) return { map, added };

  // 3. the library, on a normalised name
  const { data: lib } = await db
    .from("exercises")
    .select("id,name,primary_muscle,secondary_muscles");
  const byName = new Map<string, any>();
  for (const e of lib ?? []) byName.set(norm(e.name), e);

  const stillTodo: string[] = [];
  for (const t of todo) {
    const hit = byName.get(t);
    if (hit) {
      const r: Resolution = {
        primary_muscle: String(hit.primary_muscle ?? "").toLowerCase(),
        secondary_muscles: (hit.secondary_muscles ?? []).map((m: string) => m.toLowerCase()),
        exercise_id: hit.id,
        source: "library",
      };
      map[t] = r; added[t] = r;
    } else {
      stillTodo.push(t);
    }
  }

  if (!stillTodo.length) return { map, added };

  // 4. Claude, once per genuinely new name
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    for (const t of stillTodo) {
      map[t] = { primary_muscle: "", secondary_muscles: [], source: "unresolved" };
    }
    return { map, added };
  }

  const MUSCLES = ["chest", "back", "lats", "middle back", "lower back", "traps",
    "shoulders", "rear delts", "biceps", "triceps", "forearms", "quadriceps",
    "hamstrings", "glutes", "calves", "abdominals", "obliques", "adductors",
    "abductors", "neck"];

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `Map each gym exercise name to the muscles it trains.

These are shorthand names from one person's training log. Some are informal
("Inner thigh" = hip adduction machine), some are rehab movements
("Forward shoulder extreme slows" = slow shoulder raises).

Names:
${stillTodo.map((t) => `- ${t}`).join("\n")}

Allowed muscle values (use these exact strings, nothing else):
${MUSCLES.join(", ")}

Return only raw JSON, no markdown fences, shaped exactly:
{"<name exactly as given>": {"primary_muscle": "<one value>", "secondary_muscles": ["<zero or more>"]}}

If a name is not an exercise (a heading, a note, a date), use an empty string
for primary_muscle and an empty array for secondary_muscles.`,
      }],
    });

    const block = message.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text");
    const raw = (block?.text ?? "").trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const parsed = JSON.parse(fence ? fence[1].trim() : raw) as Record<string, any>;

    for (const t of stillTodo) {
      const got = parsed[t];
      const prim = String(got?.primary_muscle ?? "").toLowerCase();
      const r: Resolution = {
        primary_muscle: MUSCLES.includes(prim) ? prim : "",
        secondary_muscles: (got?.secondary_muscles ?? [])
          .map((m: string) => String(m).toLowerCase())
          .filter((m: string) => MUSCLES.includes(m)),
        source: MUSCLES.includes(prim) ? "ai" : "unresolved",
      };
      map[t] = r; added[t] = r;
    }
  } catch (e) {
    console.error("[resolveExercises] Claude lookup failed:", e);
    for (const t of stillTodo) {
      map[t] = { primary_muscle: "", secondary_muscles: [], source: "unresolved" };
    }
  }

  return { map, added };
}

"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getMuscleGroupCategory } from "@/lib/muscle-analysis";
import type { WeeklyPlan } from "@/lib/plan-generator";

function normalizeToken(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

function equipmentAllowedSet(tags: string[]) {
  const t = new Set(tags.map(normalizeToken));
  if (t.has(normalizeToken("Full gym access"))) return null; // allow all
  const allowed = new Set<string>();
  if (t.has(normalizeToken("Dumbbells"))) allowed.add("dumbbell");
  if (t.has(normalizeToken("Barbell and plates"))) allowed.add("barbell");
  if (t.has(normalizeToken("Resistance bands"))) allowed.add("bands");
  if (t.has(normalizeToken("Bodyweight only"))) allowed.add("body only");
  return allowed;
}

function focusMatches(primaryMuscle: string, focus: string) {
  const category = getMuscleGroupCategory(normalizeToken(primaryMuscle));
  const f = normalizeToken(focus);
  if (f === "push") return category === "push";
  if (f === "pull") return category === "pull";
  if (f === "legs" || f === "lower") return category === "legs";
  if (f === "upper") return category === "push" || category === "pull";
  if (f === "full body") return category !== "other";
  return true;
}

export async function getAlternativeExercises(currentExerciseId: number, focus: string) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) return { data: [], error: userError.message };
  if (!user) return { data: [], error: "Not authenticated" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("available_equipment")
    .eq("id", user.id)
    .single();

  const availableEquipment = Array.isArray((profile as any)?.available_equipment)
    ? ((profile as any).available_equipment as string[])
    : [];

  const allowed = equipmentAllowedSet(availableEquipment);

  let q = supabase
    .from("exercises")
    .select("id, name, primary_muscle, equipment, difficulty")
    .neq("id", currentExerciseId)
    .limit(50);

  if (allowed && allowed.size > 0) {
    const allowedArr = Array.from(allowed);
    q = q.or(`equipment.in.(${allowedArr.join(",")}),equipment.is.null`);
  }

  const { data, error } = await q;
  if (error) return { data: [], error: error.message };

  const filtered = (data ?? [])
    .filter((r: any) => focusMatches(String(r.primary_muscle ?? ""), focus))
    .slice(0, 10)
    .map((r: any) => ({
      id: Number(r.id),
      name: String(r.name),
      primary_muscle: String(r.primary_muscle ?? ""),
      equipment: r.equipment ?? null,
      difficulty: String(r.difficulty ?? ""),
    }));

  return { data: filtered, error: null as string | null };
}

export async function saveAsNewPlan(plan: WeeklyPlan, planName: string) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) return { success: false, error: userError.message, planId: null };
  if (!user) return { success: false, error: "Not authenticated", planId: null };

  const trimmedName = (planName || "").trim() || `Generated Plan ${new Date().toLocaleDateString()}`;

  // Step 1: Create the new plan
  const { data: newPlan, error: planError } = await supabase
    .from("plans")
    .insert({
      user_id: user.id,
      name: trimmedName,
      source: "generated",
      is_active: false,
    })
    .select("id")
    .single();

  if (planError || !newPlan) {
    return { success: false, error: planError?.message ?? "Failed to create plan", planId: null };
  }

  const planId = (newPlan as { id: string }).id;

  // Step 2: Build routine items linked to the new plan
  const items =
    plan?.days
      ?.flatMap((d) =>
        (d.exercises ?? []).map((ex) => ({
          user_id: user.id,
          plan_id: planId,
          exercise_id: ex.exercise_id,
          sets: ex.sets,
          reps: ex.reps,
          weight: 0,
          day_of_week: d.day_of_week,
        })),
      )
      .filter((x) => Number.isFinite(x.exercise_id) && x.exercise_id > 0) ?? [];

  // Step 3: Insert all routine entries
  if (items.length > 0) {
    const { error: insertError } = await supabase.from("routines").insert(items);
    if (insertError) {
      // Clean up the orphan plan if routine insert failed
      await supabase.from("plans").delete().eq("id", planId);
      return { success: false, error: insertError.message, planId: null };
    }
  }

  // If user's currently active plan has no exercises, auto-activate the new plan
  const { data: activePlan } = await supabase
    .from("plans")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (activePlan) {
    const activeId = (activePlan as { id: string }).id;
    const { count } = await supabase
      .from("routines")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", activeId);

    if (typeof count === "number" && count === 0) {
      // Deactivate the empty plan, then activate the new one
      await supabase.from("plans").update({ is_active: false }).eq("id", activeId);
      await supabase.from("plans").update({ is_active: true }).eq("id", planId);
    }
  } else {
    // No active plan exists at all — make this one active
    await supabase.from("plans").update({ is_active: true }).eq("id", planId);
  }

  revalidatePath("/protected");
  revalidatePath("/plans");
  return { success: true, error: null as string | null, planId };
}

type EnhanceContext = {
  experience: string;
  primaryGoal: string | null;
  imbalanceMuscles: string[];
};

export async function enhancePlanWithClaude(
  plan: WeeklyPlan,
  context: EnhanceContext,
): Promise<{ coachingNote: string | null; exerciseRationales: Record<string, string> }> {
  const empty = { coachingNote: null, exerciseRationales: {} as Record<string, string> };

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return empty;

    const client = new Anthropic({ apiKey });

    const activeDays = plan.days
      .filter((d) => d.focus !== "Rest" && d.exercises.length > 0)
      .map((d) => ({
        focus: d.focus,
        exercises: d.exercises.map((ex) => ({
          id: ex.exercise_id,
          name: ex.name,
          muscle: ex.primary_muscle,
          sets: ex.sets,
          reps: ex.reps,
        })),
      }));

    const prompt = `You are a professional fitness coach reviewing a generated workout plan.

User profile:
- Experience: ${context.experience}
- Goal: ${context.primaryGoal ?? "General fitness"}
- Imbalances being targeted: ${context.imbalanceMuscles.length > 0 ? context.imbalanceMuscles.join(", ") : "none"}

Generated plan (active training days only):
${JSON.stringify(activeDays, null, 2)}

Return a JSON object with exactly this shape:
{
  "coachingNote": "2-3 sentences. Personalized to this user's goal and experience. Motivating and specific — reference the split, the imbalances being addressed, or how the progression will work.",
  "exerciseRationales": {
    "<exercise_id as string>": "One specific motivating sentence (max 12 words) explaining why this exercise belongs in the plan."
  }
}

Rules:
- Include an entry in exerciseRationales for every exercise id that appears in the plan
- Keys must be the numeric exercise id cast to a string (e.g. "42")
- Do not suggest replacing any exercise — only write rationale text
- If any day has obviously redundant exercises (same primary muscle twice), note it briefly in the coachingNote
- Return only raw JSON. No markdown, no code fences.`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) {
      console.error("[enhancePlanWithClaude] no text block in response");
      return empty;
    }

    // Strip markdown code fences if the model included them despite instructions
    const raw = textBlock.text.trim();
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = fenceMatch ? fenceMatch[1].trim() : raw;

    const parsed = JSON.parse(jsonText) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).coachingNote !== "string"
    ) {
      console.error("[enhancePlanWithClaude] unexpected response shape:", parsed);
      return empty;
    }

    const p = parsed as { coachingNote: string; exerciseRationales?: unknown };
    const rationales =
      typeof p.exerciseRationales === "object" && p.exerciseRationales !== null
        ? (p.exerciseRationales as Record<string, string>)
        : {};

    return { coachingNote: p.coachingNote, exerciseRationales: rationales };
  } catch (err) {
    console.error("[enhancePlanWithClaude] failed:", err);
    return empty;
  }
}

export async function updateAvailableDays(days: number[]) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) return { success: false, error: userError.message };
  if (!user) return { success: false, error: "Not authenticated" };

  const normalized = Array.from(
    new Set((days ?? []).map((d) => Number(d)).filter((d) => d >= 1 && d <= 7)),
  ).sort((a, b) => a - b);

  const { error } = await supabase
    .from("profiles")
    .update({ available_days: normalized })
    .eq("id", user.id);

  if (error) return { success: false, error: error.message };

  // Revalidate only after update succeeds.
  revalidatePath("/plan");
  revalidatePath("/protected");

  return { success: true, error: null as string | null };
}


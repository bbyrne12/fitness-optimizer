"use server";

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

export async function saveAsRoutine(plan: WeeklyPlan) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) return { success: false, error: userError.message };
  if (!user) return { success: false, error: "Not authenticated" };

  const items =
    plan?.days
      ?.flatMap((d) =>
        (d.exercises ?? []).map((ex) => ({
          user_id: user.id,
          exercise_id: ex.exercise_id,
          sets: ex.sets,
          reps: ex.reps,
          weight: 0,
          day_of_week: d.day_of_week,
        })),
      )
      .filter((x) => Number.isFinite(x.exercise_id) && x.exercise_id > 0) ?? [];

  const { error: deleteError } = await supabase
    .from("routines")
    .delete()
    .eq("user_id", user.id);
  if (deleteError) return { success: false, error: deleteError.message };

  if (items.length > 0) {
    const { error: insertError } = await supabase.from("routines").insert(items);
    if (insertError) return { success: false, error: insertError.message };
  }

  revalidatePath("/protected");
  revalidatePath("/routine");
  return { success: true, error: null as string | null };
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


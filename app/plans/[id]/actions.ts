"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type ExerciseSearchHit = {
  id: number;
  name: string;
  primary_muscle: string;
  equipment: string | null;
};

type SearchResult = {
  results: ExerciseSearchHit[];
  error?: string;
};

async function getAuthedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) return { supabase, user: null, error: error.message };
  if (!user) return { supabase, user: null, error: "Not authenticated" };
  return { supabase, user, error: null as string | null };
}

async function userOwnsPlan(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  planId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase
      .from("plans")
      .select("id")
      .eq("id", planId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Plan not found" };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export async function searchExercises(query: string): Promise<SearchResult> {
  const q = (query ?? "").trim();
  if (q.length < 2) return { results: [] };

  try {
    const { supabase, user, error: authError } = await getAuthedUser();
    if (authError || !user) return { results: [], error: authError ?? "Not authenticated" };

    const safeQ = q.replace(/[%_]/g, "\\$&");
    const pattern = `%${safeQ}%`;

    const { data, error } = await supabase
      .from("exercises")
      .select("id, name, primary_muscle, equipment")
      .or(`name.ilike.${pattern},primary_muscle.ilike.${pattern}`)
      .order("name")
      .limit(20);

    if (error) return { results: [], error: error.message };

    const results: ExerciseSearchHit[] = (data ?? []).map((r: any) => ({
      id: Number(r.id),
      name: String(r.name ?? ""),
      primary_muscle: String(r.primary_muscle ?? ""),
      equipment: (r.equipment as string | null) ?? null,
    }));

    return { results };
  } catch (err) {
    return {
      results: [],
      error: err instanceof Error ? err.message : "Search failed",
    };
  }
}

export async function addExerciseToPlan(
  planId: string,
  exerciseId: number,
  dayOfWeek: number,
): Promise<{ id?: string; error?: string }> {
  if (!planId) return { error: "Missing plan id" };
  if (!Number.isFinite(exerciseId) || exerciseId <= 0) {
    return { error: "Invalid exercise" };
  }
  if (!Number.isFinite(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
    return { error: "Invalid day" };
  }

  try {
    const { supabase, user, error: authError } = await getAuthedUser();
    if (authError || !user) return { error: authError ?? "Not authenticated" };

    const owns = await userOwnsPlan(supabase, user.id, planId);
    if (!owns.ok) return { error: owns.error ?? "Plan not found" };

    const { data, error } = await supabase
      .from("routines")
      .insert({
        user_id: user.id,
        plan_id: planId,
        exercise_id: exerciseId,
        sets: 3,
        reps: 10,
        weight: 0,
        day_of_week: dayOfWeek,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };

    revalidatePath(`/plans/${planId}`);
    revalidatePath("/plans");
    revalidatePath("/protected");
    return { id: data?.id as string | undefined };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to add exercise",
    };
  }
}

export async function removeExerciseFromPlan(
  routineId: string,
  planId: string,
): Promise<{ error?: string }> {
  if (!routineId) return { error: "Missing routine id" };
  if (!planId) return { error: "Missing plan id" };

  try {
    const { supabase, user, error: authError } = await getAuthedUser();
    if (authError || !user) return { error: authError ?? "Not authenticated" };

    const { error } = await supabase
      .from("routines")
      .delete()
      .eq("id", routineId)
      .eq("user_id", user.id);
    if (error) return { error: error.message };

    revalidatePath(`/plans/${planId}`);
    revalidatePath("/protected");
    return {};
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to remove exercise",
    };
  }
}

export async function updateRoutineEntry(
  routineId: string,
  planId: string,
  updates: {
    sets?: number;
    reps?: number;
    weight?: number;
    day_of_week?: number;
  },
): Promise<{ error?: string }> {
  if (!routineId) return { error: "Missing routine id" };
  if (!planId) return { error: "Missing plan id" };

  const patch: Record<string, number> = {};

  if (updates.sets !== undefined) {
    const v = safeNumber(updates.sets);
    if (v == null) return { error: "Invalid sets value" };
    patch.sets = Math.floor(v);
  }
  if (updates.reps !== undefined) {
    const v = safeNumber(updates.reps);
    if (v == null) return { error: "Invalid reps value" };
    patch.reps = Math.floor(v);
  }
  if (updates.weight !== undefined) {
    const v = safeNumber(updates.weight);
    if (v == null) return { error: "Invalid weight value" };
    patch.weight = v;
  }
  if (updates.day_of_week !== undefined) {
    const v = safeNumber(updates.day_of_week);
    if (v == null || v < 1 || v > 7) return { error: "Invalid day" };
    patch.day_of_week = Math.floor(v);
  }

  if (Object.keys(patch).length === 0) return {};

  try {
    const { supabase, user, error: authError } = await getAuthedUser();
    if (authError || !user) return { error: authError ?? "Not authenticated" };

    const { error } = await supabase
      .from("routines")
      .update(patch)
      .eq("id", routineId)
      .eq("user_id", user.id);
    if (error) return { error: error.message };

    revalidatePath(`/plans/${planId}`);
    revalidatePath("/protected");
    return {};
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to update entry",
    };
  }
}

export async function updatePlanName(
  planId: string,
  newName: string,
): Promise<{ error?: string }> {
  if (!planId) return { error: "Missing plan id" };
  const trimmed = (newName ?? "").trim();
  if (!trimmed) return { error: "Name cannot be empty" };
  if (trimmed.length > 100) return { error: "Name is too long" };

  try {
    const { supabase, user, error: authError } = await getAuthedUser();
    if (authError || !user) return { error: authError ?? "Not authenticated" };

    const owns = await userOwnsPlan(supabase, user.id, planId);
    if (!owns.ok) return { error: owns.error ?? "Plan not found" };

    const { error } = await supabase
      .from("plans")
      .update({ name: trimmed, updated_at: new Date().toISOString() })
      .eq("id", planId)
      .eq("user_id", user.id);
    if (error) return { error: error.message };

    revalidatePath(`/plans/${planId}`);
    revalidatePath("/plans");
    return {};
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to rename plan",
    };
  }
}

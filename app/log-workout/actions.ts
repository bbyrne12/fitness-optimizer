"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type ExerciseSearchResult = {
  id: number;
  name: string;
  primary_muscle: string;
  equipment: string | null;
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

export async function searchExercises(query: string): Promise<{
  results: ExerciseSearchResult[];
  error?: string;
}> {
  const q = (query ?? "").trim();
  if (q.length < 2) return { results: [] };

  try {
    const { supabase, user, error: authError } = await getAuthedUser();
    if (authError || !user) return { results: [], error: authError ?? "Not authenticated" };

    const safeQ = q.replace(/[%_]/g, "\\$&");
    const { data, error } = await supabase
      .from("exercises")
      .select("id, name, primary_muscle, equipment")
      .ilike("name", `%${safeQ}%`)
      .order("name")
      .limit(20);

    if (error) return { results: [], error: error.message };
    return {
      results: (data ?? []).map((r: any) => ({
        id: Number(r.id),
        name: String(r.name ?? ""),
        primary_muscle: String(r.primary_muscle ?? ""),
        equipment: (r.equipment as string | null) ?? null,
      })),
    };
  } catch (err) {
    return { results: [], error: err instanceof Error ? err.message : "Search failed" };
  }
}

export async function logWorkout(payload: {
  exerciseId: number;
  sets: number;
  reps: number;
  weight: number;
  dateKey: string;
}): Promise<{ id?: string; error?: string }> {
  try {
    const { supabase, user, error: authError } = await getAuthedUser();
    if (authError || !user) return { error: authError ?? "Not authenticated" };

    const { exerciseId, sets, reps, weight, dateKey } = payload;
    if (!Number.isFinite(exerciseId) || exerciseId <= 0) return { error: "Invalid exercise" };
    if (!Number.isFinite(sets) || sets <= 0) return { error: "Sets must be greater than 0" };
    if (!Number.isFinite(reps) || reps <= 0) return { error: "Reps must be greater than 0" };
    if (!Number.isFinite(weight) || weight < 0) return { error: "Weight must be 0 or more" };

    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!m) return { error: "Invalid date" };
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const loggedAt = new Date(y, mo, d, 12, 0, 0, 0).toISOString();

    const { data, error } = await supabase
      .from("workout_logs")
      .insert({
        user_id: user.id,
        exercise_id: exerciseId,
        sets: Math.floor(sets),
        reps: Math.floor(reps),
        weight,
        logged_at: loggedAt,
      })
      .select("id")
      .single();

    if (error) return { error: error.message };

    revalidatePath("/log-workout");
    return { id: data?.id as string | undefined };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to log workout" };
  }
}

export async function deleteWorkoutLog(logId: string): Promise<{ error?: string }> {
  if (!logId) return { error: "Missing log id" };

  try {
    const { supabase, user, error: authError } = await getAuthedUser();
    if (authError || !user) return { error: authError ?? "Not authenticated" };

    const { error } = await supabase
      .from("workout_logs")
      .delete()
      .eq("id", logId)
      .eq("user_id", user.id);
    if (error) return { error: error.message };

    revalidatePath("/log-workout");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to delete log" };
  }
}


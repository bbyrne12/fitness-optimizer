"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ExerciseSearchResult = {
  id: number;
  name: string;
};

export async function searchExercises(query: string) {
  const q = query.trim();
  if (q.length < 2) return { data: [] as ExerciseSearchResult[], error: null as string | null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exercises")
    .select("id, name")
    .ilike("name", `%${q}%`)
    .order("name")
    .limit(10);

  if (error) return { data: [] as ExerciseSearchResult[], error: error.message };

  return {
    data: (data ?? []).map((row) => ({
      id: Number(row.id),
      name: String(row.name),
    })) as ExerciseSearchResult[],
    error: null as string | null,
  };
}

export type RoutineItemInput = {
  exercise_id: number;
  sets: number;
  reps: number;
  weight: number;
  day_of_week: number; // 1=Mon ... 7=Sun
};

export async function saveRoutine(items: RoutineItemInput[]) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) return { success: false, error: userError.message };
  if (!user) return { success: false, error: "You must be signed in to save a routine." };

  const normalized = (items ?? []).map((i) => ({
    exercise_id: i.exercise_id,
    sets: i.sets,
    reps: i.reps,
    weight: i.weight,
    day_of_week: i.day_of_week,
    user_id: user.id,
  }));

  const { error: deleteError } = await supabase
    .from("routines")
    .delete()
    .eq("user_id", user.id);
  if (deleteError) return { success: false, error: deleteError.message };

  if (normalized.length > 0) {
    const { error: insertError } = await supabase.from("routines").insert(normalized);
    if (insertError) return { success: false, error: insertError.message };
  }

  revalidatePath("/protected");
  return { success: true, error: null as string | null };
}


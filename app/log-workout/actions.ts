"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ExerciseSearchResult = {
  id: number;
  name: string;
};

export async function searchExercises(query: string) {
  const q = query.trim();
  if (q.length < 2) {
    return { data: [] as ExerciseSearchResult[], error: null as string | null };
  }

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

export type LogWorkoutInput = {
  exercise_id: number;
  sets: number;
  reps: number;
  weight: number;
};

export type WorkoutLogRow = {
  id: number;
  exercise_id: number;
  sets: number;
  reps: number;
  weight: number;
  logged_at: string;
};

export async function logWorkout(input: LogWorkoutInput) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) return { data: null as WorkoutLogRow | null, error: userError.message };
  if (!user) return { data: null as WorkoutLogRow | null, error: "You must be signed in to log a workout." };

  const { data, error } = await supabase
    .from("workout_logs")
    .insert({
      user_id: user.id,
      exercise_id: input.exercise_id,
      sets: input.sets,
      reps: input.reps,
      weight: input.weight,
    })
    .select("id, exercise_id, sets, reps, weight, logged_at")
    .single();

  if (error) return { data: null as WorkoutLogRow | null, error: error.message };

  revalidatePath("/protected");

  return {
    data: {
      id: Number((data as any).id),
      exercise_id: Number((data as any).exercise_id),
      sets: Number((data as any).sets),
      reps: Number((data as any).reps),
      weight: Number((data as any).weight),
      logged_at: String((data as any).logged_at),
    },
    error: null as string | null,
  };
}


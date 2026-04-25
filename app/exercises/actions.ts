"use server";

import { createClient } from "@/lib/supabase/server";

export type ExerciseRow = {
  id: number;
  name: string;
  primary_muscle: string | null;
  equipment: string | null;
  difficulty: string | null;
};

export type SearchAndFilterParams = {
  query?: string;
  muscles?: string[];
  equipment?: string[];
  offset: number;
  limit: number;
};

export async function searchAndFilterExercises(params: SearchAndFilterParams) {
  const supabase = await createClient();

  const query = (params.query ?? "").trim();
  const muscles = (params.muscles ?? []).filter(Boolean);
  const equipment = (params.equipment ?? []).filter(Boolean);

  let q = supabase
    .from("exercises")
    .select("id, name, primary_muscle, equipment, difficulty", { count: "exact" });

  if (query.length > 0) {
    q = q.ilike("name", `%${query}%`);
  }
  if (muscles.length > 0) {
    q = q.in("primary_muscle", muscles);
  }
  if (equipment.length > 0) {
    q = q.in("equipment", equipment);
  }

  const from = Math.max(0, params.offset);
  const to = Math.max(from, from + Math.max(1, params.limit) - 1);

  const { data, error, count } = await q.order("name").range(from, to);

  if (error) {
    return { exercises: [] as ExerciseRow[], totalCount: 0, error: error.message };
  }

  return {
    exercises:
      (data ?? []).map((row) => ({
        id: Number((row as any).id),
        name: String((row as any).name),
        primary_muscle:
          (row as any).primary_muscle === null
            ? null
            : String((row as any).primary_muscle),
        equipment:
          (row as any).equipment === null ? null : String((row as any).equipment),
        difficulty:
          (row as any).difficulty === null
            ? null
            : String((row as any).difficulty),
      })) as ExerciseRow[],
    totalCount: typeof count === "number" ? count : 0,
    error: null as string | null,
  };
}


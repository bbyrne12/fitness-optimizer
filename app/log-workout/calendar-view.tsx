import { createClient } from "@/lib/supabase/server";

import { CalendarGrid } from "./calendar-grid";

type LogJoinRow = {
  id: string;
  exercise_id: number | string;
  sets: number | string | null;
  reps: number | string | null;
  weight: number | string | null;
  logged_at: string;
  exercises: { name: string | null; primary_muscle: string | null } | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function dateKeyFromIso(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function safeNumber(n: unknown, fallback = 0) {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : fallback;
}

export async function CalendarView() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const since = new Date();
  since.setDate(since.getDate() - 90);

  const { data, error } = await supabase
    .from("workout_logs")
    .select("id, exercise_id, sets, reps, weight, logged_at, exercises(name, primary_muscle)")
    .gte("logged_at", since.toISOString())
    .order("logged_at", { ascending: false });

  if (error) {
    return <CalendarGrid initialWorkoutsByDay={{}} />;
  }

  const rows = (data ?? []) as unknown as LogJoinRow[];

  const workoutsByDay: Record<
    string,
    Array<{
      id: string;
      exercise_id: number;
      exercise_name: string;
      primary_muscle: string;
      sets: number;
      reps: number;
      weight: number;
      logged_at: string;
    }>
  > = {};

  for (const r of rows) {
    const key = dateKeyFromIso(r.logged_at);
    if (!workoutsByDay[key]) workoutsByDay[key] = [];
    workoutsByDay[key].push({
      id: String(r.id),
      exercise_id: safeNumber(r.exercise_id),
      exercise_name: r.exercises?.name ?? "Unknown exercise",
      primary_muscle: r.exercises?.primary_muscle ?? "",
      sets: safeNumber(r.sets),
      reps: safeNumber(r.reps),
      weight: safeNumber(r.weight),
      logged_at: String(r.logged_at),
    });
  }

  return <CalendarGrid initialWorkoutsByDay={workoutsByDay} />;
}


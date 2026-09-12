import { createClient } from "@/lib/supabase/server";
import { admin } from "@/lib/athlete/supabase";

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

  const rows = error ? [] : ((data ?? []) as unknown as LogJoinRow[]);

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

  // Sessions typed into the paste box live in athlete_sets, which has no
  // exercise_id -- the name is the name. They are merged in here so one
  // calendar shows everything, however it was entered.
  const db = admin();
  const sinceDay = since.toISOString().slice(0, 10);
  const [{ data: pasted }, { data: prof }] = await Promise.all([
    db.from("athlete_sets")
      .select("id,day,exercise,weight,reps,sets")
      .gte("day", sinceDay)
      .order("day", { ascending: false }),
    db.from("athlete_profile").select("config").eq("id", "singleton").single(),
  ]);
  const aliases = ((prof?.config ?? {}) as any).exercise_aliases ?? {};
  const normName = (n: string) =>
    n.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

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

  for (const r of pasted ?? []) {
    const key = r.day as string;
    if (!workoutsByDay[key]) workoutsByDay[key] = [];
    workoutsByDay[key].push({
      // "as:" marks the row as coming from athlete_sets, so deleting one
      // knows which table to delete from.
      id: `as:${r.id}`,
      exercise_id: 0,
      exercise_name: r.exercise as string,
      primary_muscle: aliases[normName(r.exercise as string)]?.primary_muscle ?? "",
      sets: safeNumber(r.sets),
      reps: safeNumber(r.reps),
      weight: safeNumber(r.weight),
      logged_at: `${r.day}T12:00:00.000Z`,
    });
  }

  return <CalendarGrid initialWorkoutsByDay={workoutsByDay} />;
}


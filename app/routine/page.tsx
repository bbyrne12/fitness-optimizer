import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { RoutineForm } from "./routine-form";

type RoutineJoinRow = {
  exercise_id: number | string;
  sets: number | string | null;
  reps: number | string | null;
  weight: number | string | null;
  day_of_week: number | string | null;
  exercises: {
    name: string | null;
  } | null;
};

function safeNumber(n: unknown, fallback = 0) {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function RoutineSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-6 w-44 rounded bg-muted" />
        <div className="h-4 w-full max-w-xl rounded bg-muted" />
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card className="p-6">
          <div className="h-5 w-40 rounded bg-muted" />
          <div className="mt-4 space-y-3">
            <div className="h-4 w-56 rounded bg-muted" />
            <div className="h-9 w-full rounded bg-muted" />
            <div className="h-9 w-48 rounded bg-muted" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="h-5 w-40 rounded bg-muted" />
          <div className="mt-4 space-y-3">
            <div className="h-20 w-full rounded bg-muted" />
            <div className="h-10 w-32 rounded bg-muted" />
          </div>
        </Card>
      </div>
    </div>
  );
}

async function RoutineContent() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  const { data } = await supabase
    .from("routines")
    .select("exercise_id, sets, reps, weight, day_of_week, exercises(name)")
    .eq("user_id", user.id);

  const rows = (data ?? []) as unknown as RoutineJoinRow[];
  const initialRoutine = rows
    .map((r) => ({
      exercise_id: safeNumber(r.exercise_id),
      exercise_name: r.exercises?.name ?? "Unknown exercise",
      sets: safeNumber(r.sets),
      reps: safeNumber(r.reps),
      weight: safeNumber(r.weight),
      day_of_week: safeNumber(r.day_of_week),
    }))
    .filter((x) => x.exercise_id > 0 && x.sets > 0);

  return <RoutineForm initialRoutine={initialRoutine} />;
}

export default function RoutinePage() {
  return (
    <>
      <AppNav />
      <main className="min-h-screen w-full px-4 py-10">
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <header className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              Your Current Routine
            </h1>
            <p className="text-sm text-muted-foreground">
              Add the exercises you currently do. We&apos;ll use this to analyze
              your routine and suggest improvements.
            </p>
          </header>

          <Suspense fallback={<RoutineSkeleton />}>
            <RoutineContent />
          </Suspense>
        </div>
      </main>
    </>
  );
}


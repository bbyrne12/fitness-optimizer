import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { ExerciseList } from "./exercise-list";

function ExercisePageSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-9 w-56 max-w-full rounded bg-muted" />
        <div className="h-4 w-full max-w-2xl rounded bg-muted" />
      </div>
      <Card className="p-6">
        <div className="h-9 w-full rounded bg-muted" />
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="h-8 w-24 rounded-full bg-muted" />
          <div className="h-8 w-28 rounded-full bg-muted" />
          <div className="h-8 w-20 rounded-full bg-muted" />
          <div className="h-8 w-32 rounded-full bg-muted" />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="h-28 rounded-xl bg-muted" />
          <div className="h-28 rounded-xl bg-muted" />
          <div className="h-28 rounded-xl bg-muted" />
        </div>
      </Card>
    </div>
  );
}

async function ExercisePageContent() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  const { count } = await supabase
    .from("exercises")
    .select("id", { count: "exact", head: true });

  const totalExercises = typeof count === "number" ? count : 0;

  return (
    <>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Exercise Library</h1>
        <p className="text-sm text-muted-foreground">
          Browse {totalExercises}  exercises. Search and filter to find what
          you&apos;re looking for.
        </p>
      </header>

      <ExerciseList initialTotalCount={totalExercises} />
    </>
  );
}

export default function ExercisesPage() {
  return (
    <>
      <AppNav />
      <main className="min-h-screen w-full px-4 py-10">
        <div className="mx-auto w-full max-w-6xl space-y-6">
          <Suspense fallback={<ExercisePageSkeleton />}>
            <ExercisePageContent />
          </Suspense>
        </div>
      </main>
    </>
  );
}


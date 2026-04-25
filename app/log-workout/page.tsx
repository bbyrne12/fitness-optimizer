import { Suspense } from "react";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { LogForm } from "./log-form";

function LogSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-6 w-40 rounded bg-muted" />
        <div className="h-4 w-full max-w-md rounded bg-muted" />
      </div>
      <div className="grid grid-cols-1 gap-6">
        <Card className="p-6">
          <div className="h-5 w-52 rounded bg-muted" />
          <div className="mt-4 space-y-3">
            <div className="h-20 w-full rounded bg-muted" />
            <div className="h-10 w-36 rounded bg-muted" />
          </div>
        </Card>
        <Card className="p-6">
          <div className="h-5 w-44 rounded bg-muted" />
          <div className="mt-4 space-y-3">
            <div className="h-9 w-full rounded bg-muted" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="h-9 w-full rounded bg-muted" />
              <div className="h-9 w-full rounded bg-muted" />
              <div className="h-9 w-full rounded bg-muted" />
            </div>
            <div className="h-10 w-44 rounded bg-muted" />
          </div>
        </Card>
      </div>
    </div>
  );
}

async function LogContent() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  return <LogForm />;
}

export default function LogWorkoutPage() {
  return (
    <main className="min-h-screen w-full px-4 py-10">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Log a Workout</h1>
          <p className="text-sm text-muted-foreground">
            Track an exercise you completed today.
          </p>
        </header>

        <Suspense fallback={<LogSkeleton />}>
          <LogContent />
        </Suspense>
      </div>
    </main>
  );
}


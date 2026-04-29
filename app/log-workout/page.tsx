import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { createClient } from "@/lib/supabase/server";

import { CalendarView } from "./calendar-view";

function JournalSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="h-[420px] rounded-xl border border-zinc-800 bg-zinc-900 md:col-span-2" />
        <div className="h-[420px] rounded-xl border border-zinc-800 bg-zinc-900" />
      </div>
      <div className="h-24 rounded-xl border border-zinc-800 bg-zinc-900" />
    </div>
  );
}

async function JournalContent() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) redirect("/auth/login");

  return <CalendarView />;
}

export default function LogWorkoutPage() {
  return (
    <>
      <AppNav />
      <main className="min-h-screen w-full px-4 py-10">
        <div className="mx-auto w-full max-w-6xl space-y-6">
          <header className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Workout Journal
            </h1>
            <p className="text-sm text-zinc-400">
              Track and review your training history
            </p>
          </header>

          <Suspense fallback={<JournalSkeleton />}>
            <JournalContent />
          </Suspense>
        </div>
      </main>
    </>
  );
}


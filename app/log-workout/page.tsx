import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { createClient } from "@/lib/supabase/server";

import { CalendarView } from "./calendar-view";
import { PasteLog } from "@/components/paste-log";

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

  return (
    <>
      <CalendarView />
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <PasteLog compact />
      </section>
    </>
  );
}

type Params = Promise<{ saved?: string; days?: string; today?: string }>;

// Reads the URL, so it renders inside the Suspense boundary with the journal
// rather than holding up the whole page.
async function SavedBanner({ searchParams }: { searchParams: Params }) {
  const { saved, days, today } = await searchParams;
  if (!saved) return null;
  const n = Number(days) || 1;
  return (
    <p className="rounded-md border border-lime-400/40 bg-lime-400/5 px-4 py-2 text-sm text-lime-200">
      Saved {saved} sets across {n} {n === 1 ? "session" : "sessions"}.
      {today ? " No date written, so it was filed under today." : ""}
    </p>
  );
}

export default function LogWorkoutPage({ searchParams }: { searchParams: Params }) {
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
            <SavedBanner searchParams={searchParams} />
            <JournalContent />
          </Suspense>
        </div>
      </main>
    </>
  );
}

import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { createClient } from "@/lib/supabase/server";

import { PlansView } from "./plans-view";

function PlansSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="h-4 w-24 rounded bg-zinc-800" />
        <div className="flex gap-2">
          <div className="h-9 w-44 rounded-md bg-zinc-800" />
          <div className="h-9 w-44 rounded-md bg-zinc-800" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-44 rounded-xl border border-zinc-800 bg-zinc-900"
          />
        ))}
      </div>
    </div>
  );
}

async function PlansGuard() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) redirect("/auth/login");
  return <PlansView />;
}

export default function PlansPage() {
  return (
    <>
      <AppNav />
      <main className="min-h-screen w-full px-4 py-10">
        <div className="mx-auto w-full max-w-6xl space-y-6">
          <header className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              My Plans
            </h1>
            <p className="text-sm text-zinc-400">
              Manage multiple workout plans and switch between them.
            </p>
          </header>

          <Suspense fallback={<PlansSkeleton />}>
            <PlansGuard />
          </Suspense>
        </div>
      </main>
    </>
  );
}

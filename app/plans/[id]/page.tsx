import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { createClient } from "@/lib/supabase/server";

import { PlanDetailView } from "./plan-detail-view";

import { connection } from "next/server";

function PlanDetailSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-64 rounded bg-zinc-800" />
        <div className="flex gap-2">
          <div className="h-5 w-20 rounded bg-zinc-800" />
          <div className="h-5 w-16 rounded bg-zinc-800" />
        </div>
      </div>
      <div className="h-44 rounded-xl border border-zinc-800 bg-zinc-900" />
      <div className="space-y-3">
        <div className="h-32 rounded-xl border border-zinc-800 bg-zinc-900" />
        <div className="h-32 rounded-xl border border-zinc-800 bg-zinc-900" />
      </div>
    </div>
  );
}

async function PlanDetailGuard({
  paramsPromise,
}: {
  paramsPromise: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await paramsPromise;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) redirect("/auth/login");
  return <PlanDetailView planId={id} />;
}

export default function PlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {

  return (
    <Suspense
      fallback={
        <main className="min-h-screen w-full px-4 py-10">
          <div className="mx-auto w-full max-w-4xl space-y-6">
            <PlanDetailSkeleton />
          </div>
        </main>
      }
    >
      <AppNav />
      <main className="min-h-screen w-full px-4 py-10">
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <header className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Edit Plan
            </h1>
            <p className="text-sm text-zinc-400">
              Add, remove, and adjust exercises for this plan.
            </p>
          </header>
          <PlanDetailGuard paramsPromise={params} />
        </div>
      </main>
    </Suspense>
  );
}

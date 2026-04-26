import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { PlanView } from "./plan-view";

function PlanSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-9 w-56 rounded bg-muted" />
        <div className="h-4 w-full max-w-2xl rounded bg-muted" />
      </div>
      <Card className="p-6">
        <div className="h-5 w-64 rounded bg-muted" />
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-48 rounded-xl bg-muted" />
          ))}
        </div>
      </Card>
    </div>
  );
}

async function PlanContent() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) redirect("/auth/login");

  return <PlanView />;
}

export default function PlanPage() {
  return (
    <>
      <AppNav />
      <main className="min-h-screen w-full px-4 py-10">
        <div className="mx-auto w-full max-w-6xl space-y-6">
          <header className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">Weekly Plan</h1>
            <p className="text-sm text-muted-foreground">
              A suggested week based on your routine, schedule, and equipment.
            </p>
          </header>

          <Suspense fallback={<PlanSkeleton />}>
            <PlanContent />
          </Suspense>
        </div>
      </main>
    </>
  );
}


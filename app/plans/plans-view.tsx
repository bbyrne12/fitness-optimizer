import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { PlansList, type PlanListItem } from "./plans-list";

type PlanRow = {
  id: string;
  name: string;
  source: string;
  is_active: boolean;
  created_at: string;
};

async function fetchPlansWithCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<PlanListItem[]> {
  const { data, error } = await supabase
    .from("plans")
    .select("id, name, source, is_active, created_at")
    .eq("user_id", userId)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  const rows = data as unknown as PlanRow[];

  const counts = await Promise.all(
    rows.map(async (plan) => {
      const { count, error: countError } = await supabase
        .from("routines")
        .select("id", { count: "exact", head: true })
        .eq("plan_id", plan.id)
        .eq("user_id", userId);
      if (countError) return 0;
      return count ?? 0;
    }),
  );

  return rows.map((plan, idx) => ({
    id: plan.id,
    name: plan.name,
    source: plan.source,
    is_active: plan.is_active,
    exerciseCount: counts[idx] ?? 0,
    created_at: plan.created_at,
  }));
}

function EmptyState() {
  return (
    <Card className="border-zinc-800 bg-zinc-900">
      <CardHeader>
        <CardTitle className="text-xl text-white">No plans yet</CardTitle>
        <CardDescription className="text-zinc-400">
          Create your first plan to start tracking and optimizing your training.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/plans/new"
            className="group flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-6 transition-colors hover:border-zinc-700"
          >
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300">
              <Plus className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-white">
                Create Manual Plan
              </p>
              <p className="text-sm text-zinc-400">
                Build a plan from scratch by adding the exercises you want.
              </p>
            </div>
          </Link>

          <Link
            href="/plan"
            className="group flex flex-col gap-3 rounded-xl border border-lime-400/30 bg-lime-400/5 p-6 transition-colors hover:border-lime-400/60 hover:bg-lime-400/10"
          >
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-lime-400/30 bg-lime-400/10 text-lime-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-white">
                Generate AI Plan
              </p>
              <p className="text-sm text-zinc-400">
                Get a personalized weekly plan based on your goals and routine.
              </p>
            </div>
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            asChild
            variant="outline"
            className="border-zinc-800 bg-zinc-900 text-white hover:bg-zinc-800 hover:text-white"
          >
            <Link href="/plans/new">
              <Plus className="h-4 w-4" />
              Create Manual Plan
            </Link>
          </Button>
          <Button
            asChild
            className="bg-lime-400 text-zinc-950 hover:bg-lime-300"
          >
            <Link href="/plan">
              <Sparkles className="h-4 w-4" />
              Generate AI Plan
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export async function PlansView() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const plans = await fetchPlansWithCounts(supabase, user.id);

  if (plans.length === 0) return <EmptyState />;

  return <PlansList plans={plans} />;
}

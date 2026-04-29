import Link from "next/link";
import { ArrowLeft, CheckCircle2, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { PlanDetailEditor } from "./plan-detail-editor";

type PlanRow = {
  id: string;
  name: string;
  source: string;
  is_active: boolean;
};

type RoutineJoinRow = {
  id: string;
  exercise_id: number | string;
  sets: number | string | null;
  reps: number | string | null;
  weight: number | string | null;
  day_of_week: number | string | null;
  exercises: {
    name: string | null;
    primary_muscle: string | null;
  } | null;
};

function safeNumber(n: unknown, fallback = 0): number {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && n.trim() !== "") {
    const x = Number(n);
    if (Number.isFinite(x)) return x;
  }
  return fallback;
}

function NotFoundCard() {
  return (
    <Card className="border-zinc-800 bg-zinc-900">
      <CardHeader>
        <CardTitle className="text-xl text-white">Plan not found</CardTitle>
        <CardDescription className="text-zinc-400">
          This plan may have been deleted, or you don&apos;t have access to it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          asChild
          variant="outline"
          className="border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800 hover:text-white"
        >
          <Link href="/plans">
            <ArrowLeft className="h-4 w-4" />
            Back to plans
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export async function PlanDetailView({ planId }: { planId: string }) {
  const supabase = await createClient();

  const { data: planData, error: planError } = await supabase
    .from("plans")
    .select("id, name, source, is_active")
    .eq("id", planId)
    .maybeSingle();

  if (planError || !planData) return <NotFoundCard />;

  const plan = planData as unknown as PlanRow;

  const { data: routineRows } = await supabase
    .from("routines")
    .select(
      "id, exercise_id, sets, reps, weight, day_of_week, exercises(name, primary_muscle)",
    )
    .eq("plan_id", planId)
    .order("day_of_week", { ascending: true });

  const initialRoutines = ((routineRows ?? []) as unknown as RoutineJoinRow[]).map((r) => ({
    id: String(r.id),
    exercise_id: safeNumber(r.exercise_id),
    sets: safeNumber(r.sets),
    reps: safeNumber(r.reps),
    weight: safeNumber(r.weight),
    day_of_week: safeNumber(r.day_of_week),
    exercises: r.exercises
      ? {
          name: r.exercises.name ?? "Unknown exercise",
          primary_muscle: r.exercises.primary_muscle ?? "",
        }
      : null,
  }));

  const isGenerated = plan.source === "generated";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            {plan.name}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {isGenerated ? (
              <Badge className="gap-1 bg-lime-400/10 text-lime-400 hover:bg-lime-400/20">
                <Sparkles className="h-3 w-3" />
                Generated
              </Badge>
            ) : (
              <Badge
                variant="secondary"
                className="bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              >
                Manual
              </Badge>
            )}
            {plan.is_active && (
              <Badge className="gap-1 bg-lime-400 text-zinc-950 hover:bg-lime-300">
                <CheckCircle2 className="h-3 w-3" />
                Active
              </Badge>
            )}
          </div>
        </div>
      </div>

      <PlanDetailEditor
        planId={plan.id}
        planName={plan.name}
        initialRoutines={initialRoutines}
      />
    </div>
  );
}

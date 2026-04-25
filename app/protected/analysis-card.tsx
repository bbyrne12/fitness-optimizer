import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  analyzeRoutine,
  getVolumeLevel,
  type RoutineExercise,
} from "@/lib/muscle-analysis";
import { createClient } from "@/lib/supabase/server";

type RoutineRow = {
  exercise_id: number | string;
  sets: number | string | null;
  reps: number | string | null;
  weight: number | string | null;
  day_of_week: number | string | null;
  exercises: {
    name: string | null;
    primary_muscle: string | null;
    secondary_muscles: string[] | null;
  } | null;
};

function safeNumber(n: unknown, fallback = 0) {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function formatPushPull(push: number, pull: number) {
  if (push === 0 && pull === 0) return "0:0";
  if (push === 0) return "0:1";
  const normalizedPull = pull / push;
  return `1:${round1(normalizedPull)}`;
}

function round1(n: number) {
  if (!Number.isFinite(n)) return "∞";
  return (Math.round(n * 10) / 10).toString();
}

function levelToBarClass(level: ReturnType<typeof getVolumeLevel>) {
  switch (level) {
    case "none":
      return "bg-red-500/70";
    case "low":
      return "bg-orange-500/70";
    case "moderate":
      return "bg-green-500/70";
    case "high":
      return "bg-blue-500/70";
    case "very_high":
      return "bg-purple-500/70";
  }
}

function severityBadge(severity: "high" | "medium" | "low") {
  if (severity === "high") {
    return <Badge variant="destructive">High</Badge>;
  }
  if (severity === "medium") {
    return (
      <Badge
        variant="secondary"
        className="bg-yellow-500/20 text-yellow-800 dark:text-yellow-200"
      >
        Medium
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Low
    </Badge>
  );
}

export async function RoutineAnalysisCard() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  // If the session is missing here, the page-level auth guard should have
  // already redirected. We still fail gracefully.
  if (userError || !user) {
    return null;
  }

  const { data, error } = await supabase
    .from("routines")
    .select("exercise_id, sets, reps, weight, day_of_week, exercises(name, primary_muscle, secondary_muscles)")
    .eq("user_id", user.id);

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Routine Analysis</CardTitle>
          <CardDescription>We couldn&apos;t load your routine right now.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </CardContent>
      </Card>
    );
  }

  const rows = (data ?? []) as unknown as RoutineRow[];

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Routine Analysis</CardTitle>
          <CardDescription>
            Add exercises to your routine to see analysis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/routine">Set up your routine</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const routine: RoutineExercise[] = rows
    .map((r) => {
      const ex = r.exercises;
      return {
        exercise_id: safeNumber(r.exercise_id),
        name: ex?.name ?? "Unknown exercise",
        primary_muscle: ex?.primary_muscle ?? "",
        secondary_muscles: ex?.secondary_muscles ?? [],
        sets: safeNumber(r.sets),
        reps: safeNumber(r.reps),
        weight: safeNumber(r.weight),
        day_of_week: safeNumber(r.day_of_week),
      };
    })
    .filter((x) => x.exercise_id > 0 && x.sets > 0);

  if (routine.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Routine Analysis</CardTitle>
          <CardDescription>
            Add exercises to your routine to see analysis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/routine">Set up your routine</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const analysis = analyzeRoutine(routine);

  const volumeEntries = Object.entries(analysis.weeklyVolume).sort((a, b) => b[1] - a[1]);
  const maxVolume = volumeEntries.length > 0 ? volumeEntries[0][1] : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Routine Analysis</CardTitle>
        <CardDescription>
          Weekly volume, balance, and recommendations based on your current routine.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Top stats */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Total weekly sets</p>
            <p className="mt-1 text-2xl font-semibold">{analysis.totalSets}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Days per week</p>
            <p className="mt-1 text-2xl font-semibold">{analysis.daysPerWeek}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Push : Pull</p>
            <p className="mt-1 text-2xl font-semibold">
              {formatPushPull(analysis.pushPullRatio.push, analysis.pushPullRatio.pull)}
            </p>
          </div>
        </div>

        {/* Weekly volume */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Weekly Volume by Muscle Group</h3>
          <div className="space-y-3">
            {volumeEntries.map(([muscle, sets]) => {
              const level = getVolumeLevel(sets);
              const pct =
                maxVolume > 0 ? Math.max(0, Math.min(100, (sets / maxVolume) * 100)) : 0;
              return (
                <div key={muscle} className="space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium capitalize">{muscle}</p>
                    <p className="text-sm text-muted-foreground">{Math.round(sets * 10) / 10} sets</p>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted">
                    <div
                      className={`h-2 rounded-full ${levelToBarClass(level)} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Imbalances */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Imbalances Detected</h3>
          {analysis.imbalances.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No major imbalances detected. Nice work.
            </p>
          ) : (
            <div className="space-y-3">
              {analysis.imbalances.map((imb, idx) => (
                <div
                  key={`${imb.title}-${idx}`}
                  className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    {severityBadge(imb.severity)}
                    <div className="space-y-1">
                      <p className="font-semibold">{imb.title}</p>
                      <p className="text-sm text-muted-foreground">{imb.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recommendations */}
        {analysis.recommendations.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Recommendations</h3>
            <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
              {analysis.recommendations.map((r, idx) => (
                <li key={`${r}-${idx}`}>{r}</li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


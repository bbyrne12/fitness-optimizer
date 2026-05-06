"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ArrowRightLeft, Save, Sparkles, Trash2 } from "lucide-react";

import type { WeeklyPlan } from "@/lib/plan-generator";
import { getAlternativeExercises, saveAsNewPlan, updateAvailableDays } from "./actions";

const DAYS: Array<{ d: number; short: string; label: string }> = [
  { d: 1, short: "Mon", label: "Monday" },
  { d: 2, short: "Tue", label: "Tuesday" },
  { d: 3, short: "Wed", label: "Wednesday" },
  { d: 4, short: "Thu", label: "Thursday" },
  { d: 5, short: "Fri", label: "Friday" },
  { d: 6, short: "Sat", label: "Saturday" },
  { d: 7, short: "Sun", label: "Sunday" },
];

function focusTopBorderClass(focus: string) {
  const f = focus.toLowerCase();
  if (f === "push") return "border-t-red-500";
  if (f === "pull") return "border-t-blue-500";
  if (f === "legs") return "border-t-green-500";
  if (f === "upper") return "border-t-orange-500";
  if (f === "lower") return "border-t-purple-500";
  if (f === "full body") return "border-t-indigo-500";
  if (f === "cardio") return "border-t-orange-500";
  return "border-t-gray-300";
}

type Alt = { id: number; name: string; primary_muscle: string };

export function PlanEditor({
  initialPlan,
  initialAvailableDays,
  coachingNote,
}: {
  initialPlan: WeeklyPlan;
  initialAvailableDays: number[];
  coachingNote?: string | null;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<WeeklyPlan>(initialPlan);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();
  const [isRegenerating, startRegenerate] = useTransition();

  const [swapState, setSwapState] = useState<{
    openKey: string | null;
    loading: boolean;
    options: Alt[];
  }>({ openKey: null, loading: false, options: [] });

  const [selectedDays, setSelectedDays] = useState<number[]>(
    () => initialAvailableDays ?? [],
  );

  // When the Server Component re-fetches (after router.refresh), the props will
  // change. Keep local editable state in sync with the newest server-provided plan.
  useEffect(() => {
    setPlan(initialPlan);
  }, [initialPlan]);

  useEffect(() => {
    setSelectedDays(initialAvailableDays ?? []);
  }, [initialAvailableDays]);

  const byDay = useMemo(() => {
    const map = new Map<number, (WeeklyPlan["days"][number] | null)>();
    for (const d of plan.days ?? []) map.set(d.day_of_week, d);
    return map;
  }, [plan.days]);

  const setSwapOpen = async (key: string, currentExerciseId: number, focus: string) => {
    setSwapState({ openKey: key, loading: true, options: [] });
    const res = await getAlternativeExercises(currentExerciseId, focus);
    if (res.error) {
      setError(res.error);
      setSwapState({ openKey: null, loading: false, options: [] });
      return;
    }
    setError(null);
    setSwapState({
      openKey: key,
      loading: false,
      options: (res.data ?? []).map((x: any) => ({
        id: x.id,
        name: x.name,
        primary_muscle: x.primary_muscle,
      })),
    });
  };

  const applySwap = (dayIdx: number, exIdx: number, alt: Alt) => {
    setPlan((prev) => {
      const days = [...(prev.days ?? [])];
      const day = days[dayIdx];
      if (!day) return prev;
      const exercises = [...(day.exercises ?? [])];
      const existing = exercises[exIdx];
      if (!existing) return prev;
      exercises[exIdx] = {
        ...existing,
        exercise_id: alt.id,
        name: alt.name,
        primary_muscle: alt.primary_muscle,
        rationale: "Swapped for variety and fit.",
      };
      days[dayIdx] = {
        ...day,
        exercises,
        totalSets: exercises.reduce((s, e) => s + e.sets, 0),
      };
      return { ...prev, days };
    });
    setSwapState({ openKey: null, loading: false, options: [] });
  };

  const removeExercise = (dayIdx: number, exIdx: number) => {
    setPlan((prev) => {
      const days = [...(prev.days ?? [])];
      const day = days[dayIdx];
      if (!day) return prev;
      const exercises = (day.exercises ?? []).filter((_, i) => i !== exIdx);
      days[dayIdx] = {
        ...day,
        exercises,
        totalSets: exercises.reduce((s, e) => s + e.sets, 0),
      };
      return { ...prev, days };
    });
  };

  const onSave = () => {
    setError(null);
    const defaultName = `Generated Plan - ${new Date().toLocaleDateString()}`;
    const planName = window.prompt(
      "Name this plan:",
      defaultName,
    );
    if (planName === null) return; // user cancelled
    startSave(async () => {
      const res = await saveAsNewPlan(plan, planName);
      if (!res.success || !res.planId) {
        setError(res.error ?? "Failed to save plan.");
        return;
      }
      router.push(`/plans/${res.planId}`);
      router.refresh();
    });
  };

  const toggleDay = (d: number) => {
    setSelectedDays((prev) => {
      const has = prev.includes(d);
      const next = has ? prev.filter((x) => x !== d) : [...prev, d];
      return next.sort((a, b) => a - b);
    });
  };

  const onRegenerate = () => {
    setError(null);
    startRegenerate(async () => {
      const res = await updateAvailableDays(selectedDays);
      if (!res.success) {
        setError(res.error ?? "Failed to update schedule.");
        return;
      }
      // Force Next.js to re-fetch Server Components and re-render the new plan.
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {coachingNote && (
        <div className="flex items-start gap-3 rounded-lg border border-lime-400/30 bg-lime-400/10 p-4 text-sm text-zinc-300">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-lime-400" />
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-lime-400">
              Coach&apos;s Note
            </p>
            <p>{coachingNote}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Edit the plan, then save it as your routine.
          </p>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-2">
        <p className="text-sm text-muted-foreground">
          Review each day and swap/remove exercises if needed.
        </p>
        <Button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          {isSaving ? "Saving..." : "Save as new plan"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {DAYS.map(({ d, short }) => {
              const active = selectedDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground border-transparent"
                      : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {short}
                </button>
              );
            })}

            <div className="flex-1" />

            <Button
              type="button"
              onClick={onRegenerate}
              disabled={selectedDays.length === 0 || isRegenerating}
            >
              {isRegenerating ? "Regenerating..." : "Regenerate Plan"}
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            {selectedDays.length} days per week selected
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {DAYS.map(({ d, label, short }) => {
          const plannedDay = byDay.get(d) ?? null;
          const focus = plannedDay?.focus ?? "Rest";
          const exercises = plannedDay?.exercises ?? [];
          const totalSets = plannedDay?.totalSets ?? 0;
          const isRest = focus.toLowerCase() === "rest" || exercises.length === 0;

          return (
            <Card
              key={d}
              className={cn(
                "overflow-hidden border-t-4",
                focusTopBorderClass(focus),
                isRest ? "min-h-[120px] bg-muted/20" : "min-h-[260px]",
              )}
            >
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-xl font-semibold leading-tight">
                      {label}
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {isRest ? "Rest day" : `${totalSets} sets total`}
                    </p>
                  </div>
                  <Badge variant="secondary" className="capitalize text-sm">
                    {focus}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className={cn(isRest ? "pt-0" : "px-0 pt-0")}>
                {isRest ? null : (
                  <div className="divide-y">
                    {exercises.map((ex, exIdx) => {
                      const dayIdx = (plan.days ?? []).findIndex((x) => x.day_of_week === d);
                      const key = `${d}-${ex.exercise_id}-${exIdx}`;
                      const swapOpen = swapState.openKey === key;

                      return (
                        <div key={key} className="group">
                          <div className="flex gap-3 px-4 py-3 transition-colors hover:bg-accent/40">
                            <div className="flex-1 space-y-1">
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-sm font-medium whitespace-normal break-words">
                                  {ex.name}
                                </p>
                                <p className="shrink-0 text-sm font-mono text-muted-foreground whitespace-nowrap">
                                  {ex.sets} × {ex.reps}
                                </p>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                <span className="capitalize">{ex.primary_muscle}</span>
                                {ex.rationale ? ` • ${ex.rationale}` : null}
                              </p>
                            </div>

                            <div className="flex gap-1 self-start opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-8 w-8"
                                onClick={() => setSwapOpen(key, ex.exercise_id, focus)}
                                title="Swap"
                              >
                                <ArrowRightLeft className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-8 w-8"
                                onClick={() => dayIdx >= 0 && removeExercise(dayIdx, exIdx)}
                                title="Remove"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          {swapOpen && (
                            <div className="px-4 pb-3">
                              <div className="rounded-md border bg-background p-2">
                                {swapState.loading ? (
                                  <p className="text-xs text-muted-foreground">Loading...</p>
                                ) : swapState.options.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    No alternatives found.
                                  </p>
                                ) : (
                                  <div className="space-y-1">
                                    {swapState.options.map((alt) => (
                                      <button
                                        key={alt.id}
                                        type="button"
                                        className="w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
                                        onClick={() =>
                                          dayIdx >= 0 && applySwap(dayIdx, exIdx, alt)
                                        }
                                      >
                                        {alt.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}


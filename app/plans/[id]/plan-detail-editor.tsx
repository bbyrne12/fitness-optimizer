"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeft, Plus, Search, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { addExerciseToPlan, removeExerciseFromPlan, searchExercises, updateRoutineEntry, type ExerciseSearchHit } from "./actions";

type RoutineEntry = {
  id: string;
  exercise_id: number;
  sets: number;
  reps: number;
  weight: number;
  day_of_week: number;
  exercises: { name: string; primary_muscle: string } | null;
};

const DAYS: Array<{ d: number; short: string; label: string }> = [
  { d: 1, short: "Mon", label: "Monday" },
  { d: 2, short: "Tue", label: "Tuesday" },
  { d: 3, short: "Wed", label: "Wednesday" },
  { d: 4, short: "Thu", label: "Thursday" },
  { d: 5, short: "Fri", label: "Friday" },
  { d: 6, short: "Sat", label: "Saturday" },
  { d: 7, short: "Sun", label: "Sunday" },
];

const DAY_LABEL: Record<number, string> = Object.fromEntries(
  DAYS.map((d) => [d.d, d.label]),
);

type EditableField = "sets" | "reps" | "weight";

const FIELDS: Array<{ key: EditableField; label: string; step: number }> = [
  { key: "sets", label: "Sets", step: 1 },
  { key: "reps", label: "Reps", step: 1 },
  { key: "weight", label: "Weight", step: 2.5 },
];

const NUM_INPUT_CLASS =
  "h-9 w-20 border-zinc-700 bg-zinc-950 text-center text-sm text-white";

export function PlanDetailEditor({
  planId,
  initialRoutines,
}: {
  planId: string;
  planName: string;
  initialRoutines: RoutineEntry[];
}) {
  const router = useRouter();
  const [routines, setRoutines] = useState<RoutineEntry[]>(initialRoutines);
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ExerciseSearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRoutines(initialRoutines);
  }, [initialRoutines]);

  const grouped = useMemo(() => {
    const map = new Map<number, RoutineEntry[]>();
    for (const r of routines) {
      const day = Number.isFinite(r.day_of_week) ? r.day_of_week : 0;
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(r);
    }
    return Array.from(map.entries())
      .filter(([day]) => day >= 1 && day <= 7)
      .sort(([a], [b]) => a - b);
  }, [routines]);

  const runSearch = async (q: string) => {
    setError(null);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    const res = await searchExercises(q);
    setIsSearching(false);
    if (res.error) {
      setError(res.error);
      setSearchResults([]);
      return;
    }
    setSearchResults(res.results);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      runSearch(searchQuery.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const onAddExercise = (hit: ExerciseSearchHit) => {
    setError(null);
    startTransition(async () => {
      const res = await addExerciseToPlan(planId, hit.id, selectedDay);
      if (res.error || !res.id) {
        setError(res.error ?? "Failed to add exercise");
        return;
      }
      setRoutines((prev) => [...prev, {
        id: res.id!,
        exercise_id: hit.id,
        sets: 3,
        reps: 10,
        weight: 0,
        day_of_week: selectedDay,
        exercises: { name: hit.name, primary_muscle: hit.primary_muscle },
      }]);
      setSearchQuery("");
      setSearchResults([]);
      router.refresh();
    });
  };

  const onRemove = (routineId: string) => {
    setError(null);
    startTransition(async () => {
      const res = await removeExerciseFromPlan(routineId, planId);
      if (res.error) {
        setError(res.error);
        return;
      }
      setRoutines((prev) => prev.filter((r) => r.id !== routineId));
      router.refresh();
    });
  };

  const onFieldChange = (routineId: string, field: EditableField, rawValue: string) => {
    const num = Number(rawValue);
    const safe = Number.isFinite(num) && num >= 0 ? num : 0;
    setRoutines((prev) => prev.map((r) => (r.id === routineId ? { ...r, [field]: safe } : r)));
  };

  const onFieldCommit = (routineId: string, field: EditableField, value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    setError(null);
    startTransition(async () => {
      const res = await updateRoutineEntry(routineId, planId, { [field]: value });
      if (res.error) setError(res.error);
    });
  };

  return (
    <div className="space-y-6">
      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg text-white">Add Exercise</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-zinc-400">
              Day
            </Label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(({ d, short }) => {
                const active = selectedDay === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setSelectedDay(d)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                      active
                        ? "border-transparent bg-lime-400 text-zinc-950"
                        : "border-zinc-700 bg-transparent text-zinc-400 hover:border-zinc-500 hover:text-white",
                    )}
                  >
                    {short}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="exercise-search" className="text-xs uppercase tracking-wider text-zinc-400">
              Search exercises
            </Label>
            <div className="flex gap-2">
              <Input
                id="exercise-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(searchQuery.trim()); } }}
                placeholder="Search by name or muscle..."
                className="border-zinc-700 bg-zinc-950 text-white placeholder:text-zinc-500"
              />
              {isSearching && <span className="text-xs text-zinc-400">Searching...</span>}
              </div>

            {searchResults.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                <ul className="max-h-64 divide-y divide-zinc-800 overflow-y-auto">
                  {searchResults.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => onAddExercise(hit)}
                        disabled={isPending}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-zinc-900 disabled:opacity-50"
                      >
                        <div>
                          <p className="text-sm font-medium text-white">
                            {hit.name}
                          </p>
                          <p className="text-xs capitalize text-zinc-400">
                            {hit.primary_muscle}
                            {hit.equipment ? ` · ${hit.equipment}` : ""}
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-lime-400">
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-300">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-300/70 hover:text-red-200"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {grouped.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-900">
          <CardContent className="py-10 text-center">
            <p className="text-sm text-zinc-400">
              No exercises in this plan yet. Search above to add your first exercise.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, items]) => (
            <Card key={day} className="border-zinc-800 bg-zinc-900">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base text-white">
                    {DAY_LABEL[day] ?? `Day ${day}`}
                  </CardTitle>
                  <span className="text-xs text-zinc-500">
                    {items.length} {items.length === 1 ? "exercise" : "exercises"}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {r.exercises?.name ?? "Unknown exercise"}
                      </p>
                      <p className="truncate text-xs capitalize text-zinc-500">
                        {r.exercises?.primary_muscle ?? ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {FIELDS.map(({ key, label, step }) => (
                        <label
                          key={key}
                          className="flex flex-col items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"
                        >
                          {label}
                          <Input
                            type="number"
                            min={0}
                            step={step}
                            value={Number.isFinite(r[key]) ? r[key] : 0}
                            disabled={isPending}
                            onChange={(e) => onFieldChange(r.id, key, e.target.value)}
                            onBlur={(e) => {
                              const n = Number(e.target.value);
                              if (Number.isFinite(n) && n >= 0) {
                                onFieldCommit(r.id, key, n);
                              }
                            }}
                            className={NUM_INPUT_CLASS}
                          />
                        </label>
                      ))}
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => onRemove(r.id)}
                        disabled={isPending}
                        className="h-9 w-9 border-red-900/60 bg-transparent text-red-300 hover:bg-red-950/40 hover:text-red-200"
                        aria-label="Remove exercise"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
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
        <p className="text-xs text-zinc-500">
          {isPending ? "Saving changes..." : "Changes save automatically"}
        </p>
      </div>
    </div>
  );
}

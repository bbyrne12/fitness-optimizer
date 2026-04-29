"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dumbbell, Plus, Search, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { deleteWorkoutLog, logWorkout, searchExercises } from "./actions";

type Workout = {
  id: string;
  exercise_id: number;
  exercise_name: string;
  primary_muscle: string;
  sets: number;
  reps: number;
  weight: number;
};

type SearchHit = { id: number; name: string; primary_muscle: string; equipment: string | null };

export function DayDetail({
  selectedDay,
  workouts,
  onWorkoutAdded,
  onWorkoutRemoved,
}: {
  selectedDay: string | null;
  workouts: Workout[];
  onWorkoutAdded: (w: Workout & { logged_at: string }) => void;
  onWorkoutRemoved: (id: string) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [adding, setAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<SearchHit | null>(null);
  const [sets, setSets] = useState(3);
  const [reps, setReps] = useState(10);
  const [weight, setWeight] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  const dayLabel = useMemo(() => {
    if (!selectedDay) return "";
    const d = parseDateKey(selectedDay);
    if (!d) return selectedDay;
    return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(d);
  }, [selectedDay]);

  const resetAdd = () => {
    setAdding(false);
    setSearchQuery("");
    setSearchResults([]);
    setSelectedExercise(null);
    setSets(3);
    setReps(10);
    setWeight(0);
    setError(null);
  };

  const runSearch = async () => {
    setError(null);
    const q = searchQuery.trim();
    if (q.length < 2) return setSearchResults([]);
    setIsSearching(true);
    const res = await searchExercises(q);
    setIsSearching(false);
    if (res.error) return setError(res.error);
    setSearchResults(res.results as any);
  };

  const onSave = () => {
    if (!selectedDay) return;
    if (!selectedExercise) return setError("Choose an exercise first.");
    setError(null);
    startTransition(async () => {
      const res = await logWorkout({ exerciseId: selectedExercise.id, sets, reps, weight, dateKey: selectedDay });
      if (res.error || !res.id) return setError(res.error ?? "Failed to log workout");
      onWorkoutAdded({
        id: res.id,
        exercise_id: selectedExercise.id,
        exercise_name: selectedExercise.name,
        primary_muscle: selectedExercise.primary_muscle,
        sets,
        reps,
        weight,
        logged_at: `${selectedDay}T12:00:00.000Z`,
      });
      resetAdd();
      router.refresh();
    });
  };

  const onDelete = (id: string) => {
    setError(null);
    startTransition(async () => {
      const res = await deleteWorkoutLog(id);
      if (res.error) return setError(res.error);
      onWorkoutRemoved(id);
      router.refresh();
    });
  };

  if (!selectedDay) {
    return (
      <Card className="border-zinc-800 bg-zinc-900">
        <CardContent className="py-10 text-center">
          <p className="text-sm text-zinc-400">Select a day to see your workouts</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg text-white">{dayLabel}</CardTitle>
            <p className="text-xs text-zinc-500">{selectedDay}</p>
          </div>
          <Badge className="bg-lime-400/10 text-lime-400 hover:bg-lime-400/20">
            <Dumbbell className="h-3 w-3" />
            {workouts.length}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-300">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-red-300/70 hover:text-red-200" aria-label="Dismiss error">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {workouts.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4 text-sm text-zinc-400">No workouts logged this day</div>
        ) : (
          <div className="space-y-3">
            {workouts.map((w) => (
              <div key={w.id} className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{w.exercise_name}</p>
                  <p className="mt-0.5 text-xs text-zinc-400">{w.sets} sets × {w.reps} reps @ {w.weight} lbs</p>
                  {w.primary_muscle && (
                    <Badge variant="secondary" className="mt-2 bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
                      {w.primary_muscle}
                    </Badge>
                  )}
                </div>
                <Button type="button" size="icon" variant="outline" onClick={() => onDelete(w.id)} disabled={isPending} className="h-9 w-9 border-red-900/60 bg-transparent text-red-300 hover:bg-red-950/40 hover:text-red-200" aria-label="Delete log">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {!adding ? (
          <Button type="button" onClick={() => setAdding(true)} className="w-full bg-lime-400 text-zinc-950 hover:bg-lime-300">
            <Plus className="h-4 w-4" />
            Add Workout
          </Button>
        ) : (
          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Add workout</p>
              <Button type="button" variant="ghost" size="icon" onClick={resetAdd} className="text-zinc-400 hover:bg-zinc-900 hover:text-white" aria-label="Cancel add">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {!selectedExercise ? (
              <div className="space-y-2">
                <Label htmlFor="exercise-search" className="text-xs uppercase tracking-wider text-zinc-400">Exercise</Label>
                <div className="flex gap-2">
                  <Input id="exercise-search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } }} placeholder="Search exercises..." className="border-zinc-700 bg-zinc-950 text-white placeholder:text-zinc-500" />
                  <Button type="button" onClick={runSearch} disabled={isSearching || searchQuery.trim().length < 2} className="bg-zinc-900 text-white hover:bg-zinc-800">
                    <Search className="h-4 w-4" />
                    {isSearching ? "..." : "Search"}
                  </Button>
                </div>

                {searchResults.length > 0 && (
                  <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                    <ul className="max-h-56 divide-y divide-zinc-800 overflow-y-auto">
                      {searchResults.map((hit) => (
                        <li key={hit.id}>
                          <button type="button" onClick={() => setSelectedExercise(hit)} className="w-full px-3 py-2 text-left transition-colors hover:bg-zinc-900">
                            <p className="text-sm font-medium text-white">{hit.name}</p>
                            <p className="text-xs capitalize text-zinc-400">{hit.primary_muscle}</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{selectedExercise.name}</p>
                    <p className="text-xs capitalize text-zinc-400">{selectedExercise.primary_muscle}</p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => setSelectedExercise(null)} className="border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white">
                    Change
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <NumberInput label="Sets" value={sets} onValue={setSets} disabled={isPending} />
                  <NumberInput label="Reps" value={reps} onValue={setReps} disabled={isPending} />
                  <NumberInput label="Weight" value={weight} onValue={setWeight} disabled={isPending} />
                </div>

                <div className="flex gap-2">
                  <Button type="button" onClick={onSave} disabled={isPending} className="flex-1 bg-lime-400 text-zinc-950 hover:bg-lime-300">Save</Button>
                  <Button type="button" variant="outline" onClick={resetAdd} disabled={isPending} className="flex-1 border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white">Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NumberInput({ label, value, onValue, disabled }: { label: string; value: number; onValue: (n: number) => void; disabled: boolean }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wider text-zinc-400">{label}</Label>
      <Input type="number" min={0} step={label === "Weight" ? 2.5 : 1} value={Number.isFinite(value) ? value : 0} disabled={disabled} onChange={(e) => { const n = Number(e.target.value); onValue(Number.isFinite(n) && n >= 0 ? n : 0); }} onFocus={(e) => e.target.select()} className="border-zinc-700 bg-zinc-950 text-white" />
    </div>
  );
}

function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(dt.getTime()) ? dt : null;
}


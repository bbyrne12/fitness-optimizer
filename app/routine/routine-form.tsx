"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Check, Plus, Trash2 } from "lucide-react";

import {
  saveRoutine,
  searchExercises,
  type ExerciseSearchResult,
} from "./actions";

type RoutineItem = {
  exercise_id: number;
  exercise_name: string;
  sets: number;
  reps: number;
  weight: number;
  day_of_week: number; // 1=Mon ... 7=Sun
};

type RoutineFormProps = {
  initialRoutine?: RoutineItem[];
};

const DAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

function formatPrescription(item: RoutineItem) {
  const weight = Number.isFinite(item.weight) ? item.weight : 0;
  return `${item.sets} x ${item.reps} @ ${weight} lbs`;
}

export function RoutineForm({ initialRoutine }: RoutineFormProps) {
  const router = useRouter();

  const [items, setItems] = useState<RoutineItem[]>(() => initialRoutine ?? []);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add exercise panel state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ExerciseSearchResult[]>([]);
  const [isSearching, startSearchTransition] = useTransition();
  const [selected, setSelected] = useState<ExerciseSearchResult | null>(null);

  const [sets, setSets] = useState<string>("");
  const [reps, setReps] = useState<string>("");
  const [weight, setWeight] = useState<string>("");
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);

  const [isSaving, startSaveTransition] = useTransition();

  const debounceRef = useRef<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<number, Array<{ item: RoutineItem; idx: number }>>();
    items.forEach((item, idx) => {
      const list = map.get(item.day_of_week) ?? [];
      list.push({ item, idx });
      map.set(item.day_of_week, list);
    });
    for (const [k, list] of map.entries()) {
      list.sort((a, b) => a.item.exercise_name.localeCompare(b.item.exercise_name));
      map.set(k, list);
    }
    return map;
  }, [items]);

  useEffect(() => {
    setError(null);
    setSuccess(null);

    const q = query.trim();
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    if (q.length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = window.setTimeout(() => {
      startSearchTransition(async () => {
        const res = await searchExercises(q);
        if (res.error) {
          setResults([]);
          setError(res.error);
          return;
        }
        setResults(res.data);
      });
    }, 250);
  }, [query, startSearchTransition]);

  const canAdd = useMemo(() => {
    if (!selected) return false;
    const s = Number(sets);
    const r = Number(reps);
    const w = Number(weight);
    if (!Number.isFinite(s) || s < 1 || s > 10) return false;
    if (!Number.isFinite(r) || r < 1 || r > 50) return false;
    if (!Number.isFinite(w) || w < 0 || w > 1000) return false;
    if (dayOfWeek < 1 || dayOfWeek > 7) return false;
    return true;
  }, [dayOfWeek, reps, selected, sets, weight]);

  const onSelectResult = (ex: ExerciseSearchResult) => {
    setSelected(ex);
    setDropdownOpen(false);
  };

  const resetAddPanel = () => {
    setQuery("");
    setResults([]);
    setSelected(null);
    setSets("");
    setReps("");
    setWeight("");
    setDayOfWeek(1);
    setDropdownOpen(false);
  };

  const onAddToRoutine = () => {
    setError(null);
    setSuccess(null);
    if (!canAdd || !selected) {
      setError("Please fill out all fields before adding an exercise.");
      return;
    }

    const newItem: RoutineItem = {
      exercise_id: selected.id,
      exercise_name: selected.name,
      sets: Number(sets),
      reps: Number(reps),
      weight: Number(weight),
      day_of_week: dayOfWeek,
    };

    setItems((prev) => [...prev, newItem]);
    resetAddPanel();
    setSuccess("Added to your routine.");
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const onSaveRoutine = () => {
    setError(null);
    setSuccess(null);
    if (items.length === 0 || isSaving) return;

    startSaveTransition(async () => {
      const res = await saveRoutine(
        items.map((i) => ({
          exercise_id: i.exercise_id,
          sets: i.sets,
          reps: i.reps,
          weight: i.weight,
          day_of_week: i.day_of_week,
        })),
      );

      if (!res.success) {
        setError(res.error ?? "Failed to save routine.");
        return;
      }

      setSuccess("Routine saved!");
      router.push("/protected");
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your routine</CardTitle>
          <CardDescription>
            Review what you&apos;ve added so far. Grouped by day of week.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No exercises added yet. Use the form below to add some.
            </p>
          ) : (
            <div className="space-y-4">
              {DAYS.filter((d) => grouped.has(d.value)).map((day) => {
                const list = grouped.get(day.value) ?? [];
                return (
                  <div key={day.value} className="space-y-2">
                    <h3 className="text-sm font-semibold">{day.label}</h3>
                    <div className="space-y-2">
                      {list.map(({ item: it, idx }) => {
                        return (
                          <div
                            key={`${it.exercise_id}-${idx}`}
                            className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <p className="font-medium truncate">
                                {it.exercise_name}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {formatPrescription(it)}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => removeItem(idx)}
                              className="gap-2"
                            >
                              <Trash2 className="h-4 w-4" />
                              Remove
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {(error || success) && (
            <div className="space-y-1">
              {error && <p className="text-sm text-red-500">{error}</p>}
              {success && (
                <p className="text-sm text-emerald-600 flex items-center gap-2">
                  <Check className="h-4 w-4" />
                  {success}
                </p>
              )}
            </div>
          )}
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="button"
            onClick={onSaveRoutine}
            disabled={items.length === 0 || isSaving}
          >
            {isSaving ? "Saving..." : "Save Routine"}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add an exercise</CardTitle>
          <CardDescription>
            Search for an exercise, then fill in your typical prescription.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-2">
            <Label htmlFor="exercise-search">Exercise name</Label>
            <div className="relative">
              <Input
                id="exercise-search"
                value={selected ? selected.name : query}
                placeholder="Search exercises (e.g., Bench Press)"
                onChange={(e) => {
                  setSelected(null);
                  setQuery(e.target.value);
                  setDropdownOpen(true);
                }}
                onFocus={() => setDropdownOpen(true)}
                autoComplete="off"
              />

              {dropdownOpen && !selected && (results.length > 0 || isSearching) && (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-md border bg-background shadow">
                  {isSearching ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      Searching...
                    </div>
                  ) : (
                    <ul className="max-h-60 overflow-auto py-1">
                      {results.map((ex) => (
                        <li key={ex.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                            onClick={() => onSelectResult(ex)}
                          >
                            {ex.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            {selected ? (
              <p className="text-xs text-muted-foreground">
                Selected: <span className="font-medium">{selected.name}</span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Type at least 2 characters to search.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="sets">Sets</Label>
              <Input
                id="sets"
                type="number"
                min={1}
                max={10}
                value={sets}
                onChange={(e) => setSets(e.target.value)}
                placeholder="3"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reps">Reps</Label>
              <Input
                id="reps"
                type="number"
                min={1}
                max={50}
                value={reps}
                onChange={(e) => setReps(e.target.value)}
                placeholder="10"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="weight">Weight (lbs)</Label>
              <Input
                id="weight"
                type="number"
                min={0}
                max={1000}
                step="0.5"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="135"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="day-of-week">Day of week</Label>
              <select
                id="day-of-week"
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                className={cn(
                  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
                )}
              >
                {DAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={resetAddPanel}
              disabled={
                !query && !selected && !sets && !reps && !weight && dayOfWeek === 1
              }
            >
              Reset
            </Button>
            <Button type="button" onClick={onAddToRoutine} disabled={!canAdd}>
              <Plus className="h-4 w-4" />
              Add to routine
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


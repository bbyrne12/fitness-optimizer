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
import { Check, Dumbbell, ListChecks } from "lucide-react";

import {
  logWorkout,
  searchExercises,
  type ExerciseSearchResult,
  type WorkoutLogRow,
} from "./actions";

type SessionLogItem = {
  exercise_id: number;
  exercise_name: string;
  sets: number;
  reps: number;
  weight: number;
  logged_at: string;
};

function formatPrescription(item: Pick<SessionLogItem, "sets" | "reps" | "weight">) {
  const weight = Number.isFinite(item.weight) ? item.weight : 0;
  return `${item.sets} x ${item.reps} @ ${weight} lbs`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function LogForm() {
  const router = useRouter();

  const [sessionLogs, setSessionLogs] = useState<SessionLogItem[]>([]);
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

  const [isLogging, startLogTransition] = useTransition();

  const debounceRef = useRef<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

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

  const canLog = useMemo(() => {
    if (!selected) return false;
    const s = Number(sets);
    const r = Number(reps);
    const w = Number(weight);
    if (!Number.isFinite(s) || s < 1 || s > 10) return false;
    if (!Number.isFinite(r) || r < 1 || r > 50) return false;
    if (!Number.isFinite(w) || w < 0 || w > 1000) return false;
    return true;
  }, [reps, selected, sets, weight]);

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
    setDropdownOpen(false);
  };

  const onLogExercise = () => {
    setError(null);
    setSuccess(null);
    if (!canLog || !selected || isLogging) {
      setError("Please fill out all fields before logging.");
      return;
    }

    const payload = {
      exercise_id: selected.id,
      sets: Number(sets),
      reps: Number(reps),
      weight: Number(weight),
    };

    startLogTransition(async () => {
      const res = await logWorkout(payload);
      if (res.error || !res.data) {
        setError(res.error ?? "Failed to log exercise.");
        return;
      }

      const row: WorkoutLogRow = res.data;
      setSessionLogs((prev) => [
        {
          exercise_id: row.exercise_id,
          exercise_name: selected.name,
          sets: row.sets,
          reps: row.reps,
          weight: row.weight,
          logged_at: row.logged_at,
        },
        ...prev,
      ]);

      setSuccess("Logged successfully.");
      resetAddPanel();
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            <CardTitle>Logged this session</CardTitle>
          </div>
          <CardDescription>
            Each exercise is saved immediately when you log it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sessionLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No exercises logged yet. Use the form below to log your first one.
            </p>
          ) : (
            <div className="space-y-2">
              {sessionLogs.map((it, idx) => (
                <div
                  key={`${it.exercise_id}-${it.logged_at}-${idx}`}
                  className="flex flex-col gap-1 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{it.exercise_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatPrescription(it)}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatTime(it.logged_at)}
                  </p>
                </div>
              ))}
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
          <Button type="button" variant="outline" onClick={() => router.push("/protected")}>
            Done logging
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Dumbbell className="h-5 w-5 text-primary" />
            <CardTitle>Log an exercise</CardTitle>
          </div>
          <CardDescription>
            Search for an exercise, enter what you did, then log it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-2">
            <Label htmlFor="exercise-search">Exercise name</Label>
            <div className="relative">
              <Input
                id="exercise-search"
                value={selected ? selected.name : query}
                placeholder="Search exercises (e.g., Squat)"
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
          </div>

          <div className="flex items-center justify-end gap-3">
            <Button type="button" onClick={onLogExercise} disabled={!canLog || isLogging}>
              {isLogging ? "Logging..." : "Log this exercise"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


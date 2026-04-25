"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Search, X } from "lucide-react";

import { searchAndFilterExercises, type ExerciseRow } from "./actions";

const PRIMARY_MUSCLES = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "quadriceps",
  "hamstrings",
  "glutes",
  "calves",
  "abdominals",
  "forearms",
] as const;

const EQUIPMENT = [
  "barbell",
  "dumbbell",
  "body only",
  "machine",
  "cable",
  "kettlebells",
  "bands",
  "other",
] as const;

function Pill({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-sm transition-colors",
        active
          ? "bg-primary text-primary-foreground border-transparent"
          : "bg-background hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function normalizeToken(value: string | null) {
  return (value ?? "").trim().toLowerCase();
}

export function ExerciseList({ initialTotalCount }: { initialTotalCount: number }) {
  const PAGE_SIZE = 30;

  const [query, setQuery] = useState("");
  const [muscles, setMuscles] = useState<string[]>([]);
  const [equipment, setEquipment] = useState<string[]>([]);

  const [results, setResults] = useState<ExerciseRow[]>([]);
  const [totalCount, setTotalCount] = useState<number>(initialTotalCount);
  const [offset, setOffset] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const debounceRef = useRef<number | null>(null);

  const hasFilters = query.trim().length > 0 || muscles.length > 0 || equipment.length > 0;
  const canLoadMore = results.length < totalCount;

  const fetchPage = (nextOffset: number, append: boolean) => {
    startTransition(async () => {
      const res = await searchAndFilterExercises({
        query,
        muscles,
        equipment,
        offset: nextOffset,
        limit: PAGE_SIZE,
      });

      if (res.error) {
        setError(res.error);
        if (!append) setResults([]);
        setTotalCount(0);
        return;
      }

      setError(null);
      setTotalCount(res.totalCount);
      setOffset(nextOffset);
      setResults((prev) => (append ? [...prev, ...res.exercises] : res.exercises));
    });
  };

  // Initial + filter/search updates (debounced)
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      fetchPage(0, false);
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, muscles, equipment]);

  const toggleMuscle = (m: string) => {
    setMuscles((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  };
  const toggleEquipment = (e: string) => {
    setEquipment((prev) =>
      prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e],
    );
  };

  const clearFilters = () => {
    setQuery("");
    setMuscles([]);
    setEquipment([]);
  };

  const foundLabel = useMemo(() => {
    if (isPending && results.length === 0) return "Searching...";
    return `${totalCount} exercises found`;
  }, [isPending, results.length, totalCount]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-lg">Search & filters</CardTitle>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search exercises by name..."
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Primary muscle</p>
            <div className="flex flex-wrap gap-2">
              {PRIMARY_MUSCLES.map((m) => (
                <Pill key={m} active={muscles.includes(m)} onClick={() => toggleMuscle(m)}>
                  {m}
                </Pill>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Equipment</p>
            <div className="flex flex-wrap gap-2">
              {EQUIPMENT.map((e) => (
                <Pill
                  key={e}
                  active={equipment.includes(e)}
                  onClick={() => toggleEquipment(e)}
                >
                  {e}
                </Pill>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">{foundLabel}</div>
            <Button type="button" variant="outline" onClick={clearFilters} disabled={!hasFilters}>
              <X className="h-4 w-4" />
              Clear filters
            </Button>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{foundLabel}</p>
      </div>

      {totalCount === 0 && !isPending ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="font-medium">No exercises match your filters</p>
            <p className="text-sm text-muted-foreground">
              Try removing some filters or searching for a different name.
            </p>
            <div>
              <Button type="button" variant="outline" onClick={clearFilters} disabled={!hasFilters}>
                Clear filters
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {results.map((ex) => {
              const pm = normalizeToken(ex.primary_muscle);
              const eq = normalizeToken(ex.equipment);
              const diff = (ex.difficulty ?? "").toString();
              return (
                <Card key={ex.id} className="transition-colors hover:bg-accent/40">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold leading-tight">{ex.name}</p>
                      {diff && (
                        <Badge variant="secondary" className="shrink-0">
                          {diff}
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {pm && (
                        <span className="inline-flex items-center rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                          {pm}
                        </span>
                      )}
                      {eq && (
                        <span className="inline-flex items-center rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                          {eq}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex justify-center pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => fetchPage(offset + PAGE_SIZE, true)}
              disabled={!canLoadMore || isPending}
            >
              {canLoadMore ? (isPending ? "Loading..." : "Load more") : "No more results"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}


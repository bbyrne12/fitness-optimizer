"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Dumbbell, Plus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { DayDetail } from "./day-detail";

type WorkoutItem = {
  id: string;
  exercise_id: number;
  exercise_name: string;
  primary_muscle: string;
  sets: number;
  reps: number;
  weight: number;
  logged_at: string;
};

export function CalendarGrid({
  initialWorkoutsByDay,
}: {
  initialWorkoutsByDay: Record<string, WorkoutItem[]>;
}) {
  const [currentMonth, setCurrentMonth] = useState<Date>(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [workoutsByDay, setWorkoutsByDay] = useState<Record<string, WorkoutItem[]>>(
    () => initialWorkoutsByDay ?? {},
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  const todayKey = useMemo(() => formatDateKey(new Date()), []);
  const monthLabel = useMemo(() => formatMonthYear(currentMonth), [currentMonth]);

  const monthCells = useMemo(() => {
    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    const daysInMonth = getDaysInMonth(y, m);
    const firstDow = getFirstDayOfMonth(y, m);

    const prevMonth = m === 0 ? 11 : m - 1;
    const prevYear = m === 0 ? y - 1 : y;
    const prevDays = getDaysInMonth(prevYear, prevMonth);

    const cells: Array<{
      date: Date;
      inMonth: boolean;
      key: string;
      dayNumber: number;
    }> = [];

    for (let i = 0; i < 42; i++) {
      const offset = i - firstDow;
      let date: Date;
      let inMonth = true;

      if (offset < 0) {
        const d = prevDays + offset + 1;
        date = new Date(prevYear, prevMonth, d);
        inMonth = false;
      } else if (offset >= daysInMonth) {
        const nextMonth = m === 11 ? 0 : m + 1;
        const nextYear = m === 11 ? y + 1 : y;
        date = new Date(nextYear, nextMonth, offset - daysInMonth + 1);
        inMonth = false;
      } else {
        date = new Date(y, m, offset + 1);
      }

      cells.push({
        date,
        inMonth,
        key: formatDateKey(date),
        dayNumber: date.getDate(),
      });
    }

    return cells;
  }, [currentMonth]);

  const selectedWorkouts = selectedDay ? workoutsByDay[selectedDay] ?? [] : [];

  const onSelectDay = (key: string) => {
    setSelectedDay(key);
    setMobileOpen(true);
  };

  const shiftMonth = (delta: number) => {
    setSelectedDay(null);
    setMobileOpen(false);
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const onWorkoutAdded = (key: string, item: WorkoutItem) => {
    setWorkoutsByDay((prev) => {
      const next = { ...prev };
      const arr = next[key] ? [...next[key]] : [];
      arr.unshift(item);
      next[key] = arr;
      return next;
    });
  };

  const onWorkoutRemoved = (key: string, id: string) => {
    setWorkoutsByDay((prev) => {
      const next = { ...prev };
      const arr = (next[key] ?? []).filter((w) => w.id !== id);
      if (arr.length === 0) delete next[key];
      else next[key] = arr;
      return next;
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card className="border-zinc-800 bg-zinc-900 md:col-span-2">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => shiftMonth(-1)}
              className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-800 hover:text-white"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <CardTitle className="text-center text-base font-semibold text-white">
              {monthLabel}
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => shiftMonth(1)}
              className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-800 hover:text-white"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-7 gap-2 text-xs text-zinc-400">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="text-center">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {monthCells.map((c) => {
              const has = (workoutsByDay[c.key]?.length ?? 0) > 0;
              const selected = selectedDay === c.key;
              const isToday = c.key === todayKey;

              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onSelectDay(c.key)}
                  className={cn(
                    "relative flex h-12 flex-col items-center justify-center rounded-lg border text-sm transition-colors",
                    "border-zinc-800 bg-zinc-950 hover:bg-zinc-900",
                    !c.inMonth && "text-zinc-700",
                    c.inMonth && "text-white",
                    has && "bg-lime-400/5",
                    selected && "ring-1 ring-lime-400/60",
                    isToday && "ring-1 ring-lime-400",
                  )}
                  aria-label={c.key}
                >
                  <span className="leading-none">{c.dayNumber}</span>
                  {has && (
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-lime-400" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <Dumbbell className="h-3.5 w-3.5 text-lime-400" />
                Logged day
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-lime-400" />
                Workout
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => onSelectDay(todayKey)}
              className="border-zinc-800 bg-zinc-950 text-zinc-200 hover:bg-zinc-800 hover:text-white"
            >
              <Plus className="h-4 w-4" />
              Log today
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="hidden md:block">
        <DayDetail
          selectedDay={selectedDay}
          workouts={selectedWorkouts.map((w) => ({
            id: w.id,
            exercise_id: w.exercise_id,
            exercise_name: w.exercise_name,
            primary_muscle: w.primary_muscle,
            sets: w.sets,
            reps: w.reps,
            weight: w.weight,
          }))}
          onWorkoutAdded={(w) => selectedDay && onWorkoutAdded(selectedDay, w)}
          onWorkoutRemoved={(id) => selectedDay && onWorkoutRemoved(selectedDay, id)}
        />
      </div>

      <div className="md:hidden">
        <DayDetail
          selectedDay={selectedDay}
          workouts={selectedWorkouts.map((w) => ({
            id: w.id,
            exercise_id: w.exercise_id,
            exercise_name: w.exercise_name,
            primary_muscle: w.primary_muscle,
            sets: w.sets,
            reps: w.reps,
            weight: w.weight,
          }))}
          onWorkoutAdded={(w) => selectedDay && onWorkoutAdded(selectedDay, w)}
          onWorkoutRemoved={(id) => selectedDay && onWorkoutRemoved(selectedDay, id)}
        />
      </div>

      {mobileOpen && selectedDay && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60 md:hidden">
          <div className="w-full rounded-t-2xl border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex justify-center pb-2">
              <div className="h-1.5 w-10 rounded-full bg-zinc-800" />
            </div>
            <div className="max-h-[75vh] overflow-auto px-1 pb-2">
              <DayDetail
                selectedDay={selectedDay}
                workouts={selectedWorkouts.map((w) => ({
                  id: w.id,
                  exercise_id: w.exercise_id,
                  exercise_name: w.exercise_name,
                  primary_muscle: w.primary_muscle,
                  sets: w.sets,
                  reps: w.reps,
                  weight: w.weight,
                }))}
                onWorkoutAdded={(w) => onWorkoutAdded(selectedDay, w)}
                onWorkoutRemoved={(id) => onWorkoutRemoved(selectedDay, id)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMobileOpen(false)}
              className="mt-2 w-full border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white"
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatMonthYear(date: Date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
    date,
  );
}


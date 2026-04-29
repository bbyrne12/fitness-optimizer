import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppNav } from "@/components/app-nav";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import {
  CalendarDays,
  Dumbbell,
  Search,
  Sparkles,
  Star,
  Target,
} from "lucide-react";

import { RoutineAnalysisCard } from "./analysis-card";

function startOfWeekUtcIso(date: Date) {
  const day = (date.getUTCDay() + 6) % 7; // Monday=0 ... Sunday=6
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  start.setUTCDate(start.getUTCDate() - day);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

function AnalysisSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border bg-card p-6 shadow space-y-5">
      <div className="space-y-2">
        <div className="h-5 w-40 rounded bg-muted" />
        <div className="h-4 w-full max-w-2xl rounded bg-muted" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="h-20 rounded-lg bg-muted" />
        <div className="h-20 rounded-lg bg-muted" />
        <div className="h-20 rounded-lg bg-muted" />
      </div>

      <div className="space-y-3">
        <div className="h-4 w-56 rounded bg-muted" />
        <div className="space-y-2">
          <div className="h-10 rounded bg-muted" />
          <div className="h-10 rounded bg-muted" />
          <div className="h-10 rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <header className="space-y-2">
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="h-9 w-72 max-w-full rounded bg-muted" />
      </header>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border bg-card shadow">
          <div className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="h-5 w-44 rounded bg-muted" />
                <div className="h-4 w-64 rounded bg-muted" />
              </div>
              <div className="h-9 w-28 rounded bg-muted" />
            </div>

            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-md bg-muted" />
                <div className="space-y-2">
                  <div className="h-4 w-24 rounded bg-muted" />
                  <div className="h-5 w-40 rounded bg-muted" />
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-md bg-muted" />
                <div className="space-y-2">
                  <div className="h-4 w-32 rounded bg-muted" />
                  <div className="h-5 w-48 rounded bg-muted" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-4 w-40 rounded bg-muted" />
                <div className="flex flex-wrap gap-2">
                  <div className="h-6 w-24 rounded-full bg-muted" />
                  <div className="h-6 w-28 rounded-full bg-muted" />
                  <div className="h-6 w-20 rounded-full bg-muted" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card shadow">
          <div className="p-6 space-y-4">
            <div className="space-y-2">
              <div className="h-5 w-32 rounded bg-muted" />
              <div className="h-4 w-44 rounded bg-muted" />
            </div>
            <div className="space-y-3">
              <div className="h-24 rounded-lg bg-muted" />
              <div className="h-24 rounded-lg bg-muted" />
            </div>
            <div className="flex justify-end">
              <div className="h-9 w-36 rounded bg-muted" />
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="space-y-2">
          <div className="h-6 w-36 rounded bg-muted" />
          <div className="h-4 w-56 rounded bg-muted" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-[110px] rounded-xl border bg-muted" />
          <div className="h-[110px] rounded-xl border bg-muted" />
          <div className="h-[110px] rounded-xl border bg-muted" />
          <div className="h-[110px] rounded-xl border bg-muted" />
        </div>
      </section>
    </div>
  );
}

async function DashboardContent() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/auth/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("primary_goal, experience_level, available_equipment")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    redirect("/onboarding");
  }

  const displayName = user.email ? user.email.split("@")[0] : "there";

  const startOfWeek = startOfWeekUtcIso(new Date());
  let workoutsThisWeek = 0;
  try {
    const { count, error } = await supabase
      .from("workout_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("logged_at", startOfWeek);
    if (!error && typeof count === "number") workoutsThisWeek = count;
  } catch {
    workoutsThisWeek = 0;
  }

  let hasRoutine = false;
  try {
    const { data: activePlan } = await supabase
      .from("plans")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (activePlan) {
      const { count, error } = await supabase
        .from("routines")
        .select("id", { count: "exact", head: true })
        .eq("plan_id", activePlan.id);
      if (!error && typeof count === "number") hasRoutine = count > 0;
    }
  } catch {
    hasRoutine = false;
  }

  const equipment: string[] = Array.isArray(profile.available_equipment)
    ? profile.available_equipment
    : [];

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">Dashboard</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome back, {displayName}
        </h1>
      </header>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Your Fitness Profile</CardTitle>
                <CardDescription>
                  The preferences we use to personalize recommendations.
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/onboarding">Edit profile</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-md border bg-background p-2">
                  <Target className="h-4 w-4 text-primary" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Primary Goal</p>
                  <p className="font-medium">{profile.primary_goal}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-md border bg-background p-2">
                  <Star className="h-4 w-4 text-primary" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    Experience Level
                  </p>
                  <p className="font-medium">{profile.experience_level}</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Available Equipment
              </p>
              <div className="flex flex-wrap gap-2">
                {equipment.length > 0 ? (
                  equipment.map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground"
                    >
                      {item}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">
                    No equipment selected.
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Stats</CardTitle>
            <CardDescription>Your week at a glance.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border bg-card p-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  Workouts this week
                </p>
                <p className="text-2xl font-semibold">{workoutsThisWeek}</p>
              </div>
              <div className="rounded-md border bg-background p-2">
                <Dumbbell className="h-4 w-4 text-primary" />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-card p-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Current routine</p>
                <p className="text-2xl font-semibold">
                  {hasRoutine ? "Set up" : "Not set"}
                </p>
              </div>
              <div className="rounded-md border bg-background p-2">
                <CalendarDays className="h-4 w-4 text-primary" />
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button asChild variant="outline">
              <Link href="/plans">Manage plans</Link>
            </Button>
          </CardFooter>
        </Card>
      </section>

      <section>
        <Suspense fallback={<AnalysisSkeleton />}>
          <RoutineAnalysisCard />
        </Suspense>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Quick Actions
            </h2>
            <p className="text-sm text-muted-foreground">
              Jump back in with one click.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="transition-colors hover:bg-accent">
            <Link href="/log-workout" className="block">
              <CardHeader className="space-y-1">
                <div className="flex items-center gap-3">
                  <div className="rounded-md border bg-background p-2">
                    <Dumbbell className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-lg">Log a Workout</CardTitle>
                </div>
                <CardDescription>
                  Track today&apos;s session in seconds.
                </CardDescription>
              </CardHeader>
            </Link>
          </Card>

          <Card className="transition-colors hover:bg-accent">
            <Link href="/plans" className="block">
              <CardHeader className="space-y-1">
                <div className="flex items-center gap-3">
                  <div className="rounded-md border bg-background p-2">
                    <CalendarDays className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-lg">Update Routine</CardTitle>
                </div>
                <CardDescription>Build a plan you can stick with.</CardDescription>
              </CardHeader>
            </Link>
          </Card>

          <Card className="transition-colors hover:bg-accent">
            <Link href="/plan" className="block">
              <CardHeader className="space-y-1">
                <div className="flex items-center gap-3">
                  <div className="rounded-md border bg-background p-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-lg">View My Plan</CardTitle>
                </div>
                <CardDescription>
                  Your personalized weekly workout plan
                </CardDescription>
              </CardHeader>
            </Link>
          </Card>

          <Card className="transition-colors hover:bg-accent">
            <Link href="/exercises" className="block">
              <CardHeader className="space-y-1">
                <div className="flex items-center gap-3">
                  <div className="rounded-md border bg-background p-2">
                    <Search className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-lg">Browse Exercises</CardTitle>
                </div>
                <CardDescription>
                  Find movements tailored to your goal.
                </CardDescription>
              </CardHeader>
            </Link>
          </Card>
        </div>
      </section>
    </div>
  );
}

export default function ProtectedPage() {
  return (
    <>
      <AppNav />
      <main className="min-h-screen w-full px-4 py-10">
        <div className="mx-auto w-full max-w-6xl">
          <Suspense fallback={<DashboardSkeleton />}>
            <DashboardContent />
          </Suspense>
        </div>
      </main>
    </>
  );
}

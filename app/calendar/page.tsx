/**
 * /calendar — the whole plan from here to race day.
 *
 * Reads the last decision the morning job wrote rather than pulling WHOOP on
 * page load: the calendar is the plan, not a live readout, and a page that
 * refreshes tokens on every visit would fight the poller for the refresh.
 */
import { Suspense } from "react";
import { admin } from "@/lib/athlete/supabase";
import { buildCalendar } from "@/lib/athlete/calendar";
import { personalFrom } from "@/lib/athlete/decide";
import { isAthleteOwner } from "@/lib/athlete/owner";

export const metadata = { title: "Training calendar" };

const KIND_COLOR: Record<string, string> = {
  "long run": "bg-lime-400",
  run: "bg-sky-400",
  "pull+run": "bg-sky-400",
  lacrosse: "bg-amber-400",
  legs: "bg-zinc-500",
  push: "bg-zinc-500",
  pull: "bg-zinc-500",
  rest: "bg-zinc-700",
};

export default function CalendarPage() {
  // cacheComponents is on, so the Supabase read has to sit inside a Suspense
  // boundary rather than blocking the whole route from rendering.
  return (
    <Suspense fallback={
      <main className="mx-auto max-w-4xl px-5 py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          Loading the plan…
        </p>
      </main>
    }>
      <CalendarBody />
    </Suspense>
  );
}

async function CalendarBody() {
  // Built from one person's profile and decisions, read with the service role
  // key. Anyone else who is signed in gets nothing from it.
  if (!(await isAthleteOwner())) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <h1 className="text-xl font-semibold">Nothing to show</h1>
        <p className="mt-2 text-sm text-zinc-400">
          The training plan is only available to the athlete it was built for.
        </p>
      </main>
    );
  }

  const db = admin();
  const [{ data: prof }, { data: log }] = await Promise.all([
    db.from("athlete_profile").select("config").eq("id", "singleton").single(),
    db.from("decision_log").select("day,decision").order("day", { ascending: false })
      .limit(1).maybeSingle(),
  ]);

  if (!prof) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <h1 className="text-xl font-semibold">Nothing to show yet</h1>
        <p className="mt-2 text-sm text-zinc-400">
          The athlete profile has not been pushed to Supabase.
        </p>
      </main>
    );
  }

  const cfg = prof.config as Record<string, any>;
  const decision = (log?.decision ?? null) as Record<string, any> | null;
  const today = decision?.state?.date ?? new Date().toISOString().slice(0, 10);

  const { weeks, unlocked } = buildCalendar({
    raceDate: cfg.race.date,
    today,
    recentLongMi: decision?.plan?.long_run_uncapped_mi ?? 3,
    longestEver: cfg.race.longest_run_ever_mi,
    lacrosseDays: cfg.lacrosse.days,
    tennisDays: (cfg as any).tennis?.days ?? [],
    personal: personalFrom(cfg),
    z2: cfg.athlete.zone2_ceiling_bpm,
    consistencyWeeks: decision?.readiness?.weeks ?? 0,
  });

  const current = weeks[0];
  const gates = [
    { label: "Long runs", open: unlocked.long_runs, need: "3–4 consistent weeks" },
    { label: "Tempo", open: unlocked.tempo, need: "8–12 consistent weeks" },
    { label: "Intervals", open: unlocked.intervals, need: "4–6 consistent months" },
  ];

  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-lime-400">
            Training calendar
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            {weeks.length - 1} weeks to the half marathon
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {cfg.race.date} · longest run ever {cfg.race.longest_run_ever_mi} mi
          </p>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-900 px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            This block
          </p>
          <p className="mt-1 font-medium">{current.phase}</p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-400">
            {current.job}
          </p>
        </div>
      </header>

      <section className="mt-6 flex flex-wrap gap-2">
        {gates.map((g) => (
          <span
            key={g.label}
            className={`rounded-full border px-3 py-1 font-mono text-[11px] ${
              g.open
                ? "border-lime-400/40 bg-lime-400/10 text-lime-400"
                : "border-zinc-800 bg-zinc-900 text-zinc-500"
            }`}
          >
            {g.label}: {g.open ? "unlocked" : `needs ${g.need}`}
          </span>
        ))}
        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 font-mono text-[11px] text-zinc-500">
          {unlocked.weeks} consistent {unlocked.weeks === 1 ? "week" : "weeks"} of running
        </span>
      </section>

      <p className="mt-6 text-xs leading-relaxed text-zinc-500">
        Each block has one job. Every fourth week is a recovery week — volume
        down 20–30%, intensity low, mobility work up. That is not losing
        fitness, it is locking it in. Run types unlock on measured consistency,
        never on the calendar.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        {weeks.map((w) => (
          <article
            key={w.index}
            className={`rounded-lg border p-4 ${
              w.current
                ? "border-lime-400/40 bg-zinc-900"
                : w.recovery_week
                  ? "border-zinc-800 bg-zinc-900/40"
                  : "border-zinc-800 bg-zinc-900/20"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] text-zinc-500">
                  {w.start.slice(5)} – {w.end.slice(5)}
                </span>
                <span className="text-sm font-medium">{w.phase}</span>
                {w.recovery_week && (
                  <span className="rounded bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-400">
                    Recovery week
                  </span>
                )}
                {w.current && (
                  <span className="rounded bg-lime-400/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-lime-400">
                    This week
                  </span>
                )}
              </div>
              <span className="font-mono text-[11px] text-zinc-500">
                long {w.long_run_mi} mi · easy {w.easy_run_min} min
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded border border-zinc-800 bg-zinc-800 sm:grid-cols-4 lg:grid-cols-7">
              {w.days.map((d) => (
                <div
                  key={d.date}
                  className={`flex min-h-[84px] flex-col gap-1 p-2 ${
                    d.today ? "bg-zinc-800" : "bg-zinc-950"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${KIND_COLOR[d.kind] ?? "bg-zinc-700"}`}
                    />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                      {d.dow} {d.date.slice(8)}
                    </span>
                  </div>
                  <span className="text-[12px] font-medium leading-tight">
                    {d.kind}
                  </span>
                  <span className="text-[11px] leading-snug text-zinc-400">
                    {d.detail}
                  </span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

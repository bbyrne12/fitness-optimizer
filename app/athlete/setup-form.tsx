"use client";

import { useActionState, useMemo, useState, type ReactNode } from "react";

import { COMMON_SPORTS, EXCLUDED_SPORTS, slugify, sportLabel } from "@/lib/athlete/sports";

import { saveAthleteProfile, type SetupResult } from "./actions";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const INTENSITIES = ["easy", "moderate", "hard"] as const;
type Intensity = (typeof INTENSITIES)[number];

export type ActivityRow = {
  sport: string;
  label: string;
  days: string[];
  time: string;
  intensity: Intensity;
  /** Typed in by the athlete rather than picked from a list. */
  custom?: boolean;
};

export type SportSeen = { sport: string; sessions: number; cost: number | null; n: number };

export type SetupDefaults = {
  goals: string[];
  raceDistance: string;
  raceDate: string;
  raceName: string;
  liftDays: number;
  runDays: number;
  longRunDay: "Sat" | "Sun";
  activities: ActivityRow[];
  zone2: number | string;
  longestRunMi: number | string;
  /** Exact exercise names, as logged, that never get automatic increases. */
  manualLifts: string[];
  notes: string;
  emailTo: string;
};

const GOALS: [string, string][] = [
  ["hrv", "Raise HRV and recovery"],
  ["race", "Train for a race"],
  ["strength", "Build strength"],
  ["general", "General fitness"],
];

const DISTANCES: [string, string][] = [
  ["", "No race"], ["5k", "5K"], ["10k", "10K"], ["half", "Half marathon"], ["marathon", "Marathon"],
];

const NOTES_PLACEHOLDER = `e.g. Ran a 10K two years ago and got shin splints in the last month of the build.
Labrum repair last August — bench and overhead stay light.
By March I want to finish the half under 2:00 and be back squatting my bodyweight.
The call I want each morning: whether today's run happens or moves to Thursday.`;

const field =
  "rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 " +
  "placeholder:text-zinc-600 focus:border-lime-400/50 focus:outline-none focus:ring-1 focus:ring-lime-400/40";
const small = "font-mono text-[11px] uppercase tracking-wider text-zinc-500";
const hint = "text-[12px] leading-relaxed text-zinc-500";
const toggle = (on: boolean) =>
  `rounded border px-2.5 py-1.5 text-[12px] transition ${
    on ? "border-lime-400/60 bg-lime-400/10 text-lime-400" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"
  }`;

function Question({ n, title, note, children }: {
  n: number; title: string; note?: string; children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Question {n}</p>
      <h3 className="mt-1 text-base font-semibold text-white">{title}</h3>
      {note && <p className="mt-1 text-sm leading-relaxed text-zinc-400">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function CountPicker({ name, value, label }: { name: string; value: number; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={`${small} w-16`}>{label}</span>
      <div className="flex gap-1.5">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer">
            <input type="radio" name={name} value={n} defaultChecked={value === n} className="peer sr-only" />
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 font-mono text-sm text-zinc-400 peer-checked:border-lime-400/60 peer-checked:bg-lime-400/10 peer-checked:text-lime-400 peer-focus-visible:ring-1 peer-focus-visible:ring-lime-400/60">
              {n}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function costLine(seen: SportSeen | undefined) {
  if (!seen) return "Not in your WHOOP history yet, so how hard you rate it sets its cost.";
  if (seen.cost == null)
    return `${seen.sessions} sessions on WHOOP, but not enough on days of their own to measure a cost yet. Your rating stands in until there are.`;
  if (seen.cost >= -0.5)
    return `${seen.sessions} sessions on WHOOP. It barely moves your next-morning recovery (measured from ${seen.n}).`;
  return `${seen.sessions} sessions on WHOOP. The morning after costs you about ${Math.abs(seen.cost).toFixed(0)} recovery points (measured from ${seen.n}).`;
}

const inWeekOrder = (days: string[]) => DAYS.filter((d) => days.includes(d));

export function SetupForm({ defaults, accountEmail, sportsSeen, zone2Suggestion, liftNames }: {
  defaults: SetupDefaults;
  accountEmail: string;
  sportsSeen: SportSeen[];
  zone2Suggestion: number | null;
  /** Every exercise name in the athlete's own log, for the manual-lifts picker. */
  liftNames: string[];
}) {
  const [result, action, pending] = useActionState<SetupResult | null, FormData>(
    saveAthleteProfile,
    null,
  );
  const [goals, setGoals] = useState<string[]>(defaults.goals);
  const [distance, setDistance] = useState(defaults.raceDistance);
  const [rows, setRows] = useState<ActivityRow[]>(defaults.activities);
  const [zone2, setZone2] = useState(String(defaults.zone2));
  const [manual, setManual] = useState<Set<string>>(() => {
    // Saved values may be fragments from an older profile ("bench" for every
    // bench variant); a name is pre-ticked if any saved value is part of it.
    const picked = new Set<string>();
    for (const name of liftNames)
      if (defaults.manualLifts.some((m) => name.toLowerCase().includes(m.toLowerCase()))) picked.add(name);
    return picked;
  });
  const unlisted = defaults.manualLifts
    .filter((m) => !liftNames.some((n) => n.toLowerCase().includes(m.toLowerCase())))
    .join(", ");

  const seen = useMemo(() => new Map(sportsSeen.map((s) => [s.sport, s])), [sportsSeen]);
  const fromWhoop = sportsSeen.map((s) => s.sport).filter((s) => !EXCLUDED_SPORTS.has(s));
  const others = COMMON_SPORTS.filter((s) => !fromWhoop.includes(s));
  const listed = new Set([...fromWhoop, ...COMMON_SPORTS]);

  const update = (i: number, patch: Partial<ActivityRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toggleGoal = (g: string) =>
    setGoals((gs) => (gs.includes(g) ? gs.filter((x) => x !== g) : [...gs, g]));

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="activities" value={JSON.stringify(rows)} />

      <Question n={1} title="What are you training for?" note="Pick everything that applies.">
        <div className="grid gap-2 sm:grid-cols-2">
          {GOALS.map(([id, title]) => {
            const on = goals.includes(id);
            return (
              <label
                key={id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
                  on ? "border-lime-400/60 bg-lime-400/5" : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                }`}
              >
                <input
                  type="checkbox" name="goal" value={id} checked={on}
                  onChange={() => toggleGoal(id)} className="accent-lime-400"
                />
                <span className="text-sm font-medium text-white">{title}</span>
              </label>
            );
          })}
        </div>
      </Question>

      <Question
        n={2}
        title="Is there a race?"
        note={goals.includes("race")
          ? "Your goals include a race, so this one is needed."
          : "Optional. A race gives the long run something to build toward; without one the plan looks twelve weeks ahead."}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className={small}>Distance</span>
            <select
              name="race_distance" value={distance}
              onChange={(e) => setDistance(e.target.value)} className={field}
            >
              {DISTANCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {distance && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className={small}>Date</span>
                <input name="race_date" type="date" required defaultValue={defaults.raceDate} className={field} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={small}>Name (optional)</span>
                <input name="race_name" defaultValue={defaults.raceName} maxLength={60} className={field} />
              </label>
            </>
          )}
        </div>
      </Question>

      <Question
        n={3}
        title="How many days a week do you want to lift and run?"
        note="Lifting days set the split: one is full body, two is legs and upper, three is legs, pull and push. Running days include the long run."
      >
        <div className="flex flex-col gap-3">
          <CountPicker name="lift_days" value={defaults.liftDays} label="Lift" />
          <CountPicker name="run_days" value={defaults.runDays} label="Run" />
          <div className="flex flex-wrap items-center gap-3">
            <span className={`${small} w-16`}>Long run</span>
            {(["Sat", "Sun"] as const).map((d) => (
              <label key={d} className="cursor-pointer">
                <input
                  type="radio" name="long_run_day" value={d}
                  defaultChecked={defaults.longRunDay === d} className="peer sr-only"
                />
                <span className="inline-block rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-400 peer-checked:border-lime-400/60 peer-checked:bg-lime-400/10 peer-checked:text-lime-400 peer-focus-visible:ring-1 peer-focus-visible:ring-lime-400/60">
                  {d === "Sat" ? "Saturday" : "Sunday"}
                </span>
              </label>
            ))}
          </div>
        </div>
      </Question>

      <Question
        n={4}
        title="What else do you do on set days?"
        note="Sports, practices, classes. They go on their days first, and lifts and runs fit around them."
      >
        <div className="flex flex-col gap-3">
          {rows.length === 0 && (
            <p className={hint}>Nothing added. Leave this empty if lifting and running are the whole week.</p>
          )}

          {rows.map((row, i) => (
            <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Activity"
                  value={row.custom ? "__custom" : listed.has(row.sport) ? row.sport : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    update(i, v === "__custom"
                      ? { custom: true, sport: slugify(row.label), label: row.label }
                      : { custom: false, sport: v, label: sportLabel(v) });
                  }}
                  className={`${field} min-w-[13rem]`}
                >
                  <option value="" disabled>Choose an activity</option>
                  {fromWhoop.length > 0 && (
                    <optgroup label="From your WHOOP">
                      {fromWhoop.map((s) => (
                        <option key={s} value={s}>
                          {sportLabel(s)} · {seen.get(s)?.sessions} sessions
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Other activities">
                    {others.map((s) => <option key={s} value={s}>{sportLabel(s)}</option>)}
                  </optgroup>
                  <option value="__custom">Something else…</option>
                </select>
                {row.custom && (
                  <input
                    aria-label="Activity name" value={row.label} placeholder="What is it?" maxLength={40}
                    onChange={(e) => update(i, { label: e.target.value, sport: slugify(e.target.value) })}
                    className={`${field} w-48`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  className="ml-auto rounded px-2 py-1 text-[12px] text-zinc-500 hover:text-red-400"
                >
                  Remove
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Days">
                {DAYS.map((d) => {
                  const on = row.days.includes(d);
                  return (
                    <button
                      key={d} type="button" aria-pressed={on}
                      onClick={() => update(i, {
                        days: inWeekOrder(on ? row.days.filter((x) => x !== d) : [...row.days, d]),
                      })}
                      className={`${toggle(on)} font-mono`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2">
                  <span className={small}>Starts</span>
                  <input
                    type="time" value={row.time}
                    onChange={(e) => update(i, { time: e.target.value })}
                    className={`${field} w-32`}
                  />
                </label>
                <div className="flex items-center gap-1.5" role="group" aria-label="How hard">
                  <span className={`${small} mr-1`}>How hard</span>
                  {INTENSITIES.map((level) => (
                    <button
                      key={level} type="button" aria-pressed={row.intensity === level}
                      onClick={() => update(i, { intensity: level })}
                      className={`${toggle(row.intensity === level)} capitalize`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              {row.sport && !row.custom && (
                <p className={`${hint} mt-2`}>{costLine(seen.get(row.sport))}</p>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, { sport: "", label: "", days: [], time: "", intensity: "moderate" }])}
            className="self-start rounded-md border border-dashed border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-lime-400/50 hover:text-lime-400"
          >
            + Add an activity
          </button>
        </div>
      </Question>

      <Question n={5} title="Heart rate and running history">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={small}>Zone 2 ceiling (bpm)</span>
            <input
              name="zone2" type="number" min={90} max={200} required value={zone2}
              onChange={(e) => setZone2(e.target.value)} className={field}
            />
            {zone2Suggestion ? (
              <span className={hint}>
                From your WHOOP heart rate, zone 2 tops out around {zone2Suggestion}.{" "}
                {String(zone2Suggestion) !== zone2 && (
                  <button
                    type="button" onClick={() => setZone2(String(zone2Suggestion))}
                    className="text-lime-400 hover:underline"
                  >
                    Use it
                  </button>
                )}
              </span>
            ) : (
              <span className={hint}>
                Easy runs stay under it. WHOOP shows your heart rate zones; 180 minus your age is a common start.
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={small}>Longest run ever (mi)</span>
            <input
              name="longest_run_mi" type="number" min={0} step={0.1}
              defaultValue={defaults.longestRunMi} className={field}
            />
            <span className={hint}>Limits how fast the long run is allowed to grow.</span>
          </label>
        </div>
      </Question>

      <Question
        n={6}
        title="Any lifts that should stay at their current weight?"
        note="Something you're rehabbing or want to hold steady. The plan repeats these at the weight you last used and never suggests going up."
      >
        {liftNames.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {liftNames.map((name) => {
              const on = manual.has(name);
              return (
                <label key={name} className={`cursor-pointer ${toggle(on)}`}>
                  <input
                    type="checkbox" name="manual_lift" value={name} checked={on}
                    onChange={() => setManual((m) => {
                      const next = new Set(m);
                      if (next.has(name)) next.delete(name); else next.add(name);
                      return next;
                    })}
                    className="sr-only"
                  />
                  {name}
                </label>
              );
            })}
          </div>
        ) : (
          <p className={hint}>Nothing logged yet. Once you have logged workouts, your lifts appear here to pick from.</p>
        )}
        <input
          name="manual_lifts_extra" defaultValue={unlisted}
          placeholder={liftNames.length ? "Any others, comma-separated" : "e.g. bench, overhead press"}
          className={`${field} mt-3 w-full`}
        />
      </Question>

      <Question
        n={7}
        title="Anything else about where you're trying to get to?"
        note="Whatever the questions above don't cover: your history with this distance or sport and how it went, injuries or anything to work around, what you want to be true in six months if there's no race, and the one call you want the morning email to make for you."
      >
        <textarea
          name="notes" rows={7} maxLength={2000} defaultValue={defaults.notes}
          placeholder={NOTES_PLACEHOLDER}
          className={`${field} w-full leading-relaxed`}
        />
        <p className={`${hint} mt-1.5`}>Shown with your training plan so it's read alongside these answers.</p>
      </Question>

      <Question n={8} title="Where should the morning email go?">
        <input
          name="email_to" type="email" placeholder={accountEmail}
          defaultValue={defaults.emailTo} className={`${field} w-full`}
        />
        <p className={`${hint} mt-1.5`}>Leave blank to use the address you signed in with.</p>
      </Question>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-lime-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-lime-300 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save my plan"}
        </button>
        {result && (
          <p className={`text-sm ${result.ok ? "text-lime-400" : "text-red-400"}`}>{result.message}</p>
        )}
      </div>
    </form>
  );
}

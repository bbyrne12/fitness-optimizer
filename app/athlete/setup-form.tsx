"use client";

import { useActionState } from "react";

import { saveAthleteProfile, type SetupResult } from "./actions";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export type SetupDefaults = {
  emailTo: string;
  raceName: string;
  raceDate: string;
  longestRunMi: number | string;
  zone2: number | string;
  lacrosseDays: string[];
  lacrosseTime: string;
  tennisDays: string[];
  advanced: string;
};

const field =
  "w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 " +
  "placeholder:text-zinc-600 focus:border-lime-400/50 focus:outline-none focus:ring-1 focus:ring-lime-400/40";
const label = "font-mono text-[11px] uppercase tracking-wider text-zinc-500";
const hint = "text-[11px] leading-relaxed text-zinc-600";

function DayPicker({ name, selected }: { name: string; selected: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {WEEKDAYS.map((d) => (
        <label
          key={d}
          className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-[12px] text-zinc-300 has-[:checked]:border-lime-400/50 has-[:checked]:text-lime-400"
        >
          <input
            type="checkbox"
            name={name}
            value={d}
            defaultChecked={selected.includes(d)}
            className="accent-lime-400"
          />
          {d}
        </label>
      ))}
    </div>
  );
}

export function SetupForm({
  defaults,
  accountEmail,
}: {
  defaults: SetupDefaults;
  accountEmail: string;
}) {
  const [result, action, pending] = useActionState<SetupResult | null, FormData>(
    saveAthleteProfile,
    null,
  );

  return (
    <form action={action} className="mt-4 flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="race_name" className={label}>Race</label>
          <input id="race_name" name="race_name" defaultValue={defaults.raceName} className={field} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="race_date" className={label}>Race date</label>
          <input
            id="race_date" name="race_date" type="date" required
            defaultValue={defaults.raceDate} className={field}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="longest_run_mi" className={label}>Longest run ever (mi)</label>
          <input
            id="longest_run_mi" name="longest_run_mi" type="number" min="0" step="0.1"
            defaultValue={defaults.longestRunMi} className={field}
          />
          <span className={hint}>Limits how fast the long run is allowed to grow.</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="zone2" className={label}>Zone 2 ceiling (bpm)</label>
          <input
            id="zone2" name="zone2" type="number" min="90" max="200" required
            defaultValue={defaults.zone2} className={field}
          />
          <span className={hint}>
            Easy runs stay under it. WHOOP shows your heart rate zones; 180 minus
            your age is a common starting point.
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={label}>Lacrosse / team practice days</span>
        <DayPicker name="lacrosse_days" selected={defaults.lacrosseDays} />
        <div className="flex items-center gap-3">
          <label htmlFor="lacrosse_time" className={hint}>Start time</label>
          <input
            id="lacrosse_time" name="lacrosse_time" type="time"
            defaultValue={defaults.lacrosseTime} className={`${field} w-36`}
          />
        </div>
        <span className={hint}>Planned as the week&apos;s biggest session, with no lift that day.</span>
      </div>

      <div className="flex flex-col gap-2">
        <span className={label}>Tennis days</span>
        <DayPicker name="tennis_days" selected={defaults.tennisDays} />
        <span className={hint}>
          Saturday is always the long run and Sunday is rest, so only weekdays are offered.
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email_to" className={label}>Send the morning email to</label>
        <input
          id="email_to" name="email_to" type="email" placeholder={accountEmail}
          defaultValue={defaults.emailTo} className={field}
        />
        <span className={hint}>Leave blank to use the address you signed in with.</span>
      </div>

      <details className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
        <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wider text-zinc-500">
          Advanced (JSON)
        </summary>
        <p className={`${hint} mt-2`}>
          Optional. <code>cues</code>: a line per session type. <code>additions</code>: an
          extra exercise per session type, as [name, dose, why]. <code>manual_lifts</code>:
          lifts that never get automatic weight increases. <code>tunables</code> and{" "}
          <code>cadence_spm</code>. What is in this box is exactly what gets saved.
        </p>
        <textarea
          name="advanced" rows={8} spellCheck={false}
          defaultValue={defaults.advanced}
          placeholder='{"manual_lifts": ["bench"]}'
          className={`${field} mt-2 font-mono text-[12px]`}
        />
      </details>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-lime-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-lime-300 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>
        {result && (
          <p className={`text-sm ${result.ok ? "text-lime-400" : "text-red-400"}`}>
            {result.message}
          </p>
        )}
      </div>
    </form>
  );
}

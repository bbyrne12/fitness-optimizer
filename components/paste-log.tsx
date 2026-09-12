"use client";

import { useActionState } from "react";
import { saveLog, type SaveResult } from "@/app/log/actions";

const EXAMPLE = `9/14:

Leg press: 320 x 12

X4:
Inner thigh: 130 x 10
Outer thigh: 110 x 12

Calf raises: 60 x 25`;

export function PasteLog({ compact = false }: { compact?: boolean }) {
  const [result, action, pending] = useActionState<SaveResult | null, FormData>(
    saveLog,
    null,
  );

  return (
    <div className={compact ? "" : "mx-auto max-w-2xl px-5 py-10"}>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-lime-400">
        Log
      </p>
      <h2 className="mt-2 text-xl font-semibold text-white">Paste from Notes</h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
        Exactly the format you already write. Skip the date and it files under
        today; write one — 9/14, 9/14/26, 9-14 or Sept 14 all work — to log
        another day. Re-saving a day replaces it, so pasting the whole week is
        safe.
      </p>

      <form action={action} className="mt-6 flex flex-col gap-3">
        <textarea
          name="log"
          rows={compact ? 8 : 14}
          spellCheck={false}
          placeholder={EXAMPLE}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[13px] leading-relaxed text-zinc-100 placeholder:text-zinc-700 focus:border-lime-400/50 focus:outline-none focus:ring-1 focus:ring-lime-400/40"
        />
        <div className="flex items-center gap-3">
          <label className="font-mono text-[11px] text-zinc-500" htmlFor="year">
            Year
          </label>
          <input
            id="year"
            name="year"
            type="number"
            placeholder="current year"
            className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-right font-mono text-[13px] text-zinc-100 focus:border-lime-400/50 focus:outline-none"
          />
          <span className="text-[11px] text-zinc-600">
            Your dates are 9/14, so the year comes from here. Leave blank for
            this year.
          </span>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md bg-lime-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-lime-300 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save to log"}
        </button>
      </form>

      {result && (
        <div
          className={`mt-6 rounded-md border p-4 ${
            result.ok
              ? "border-lime-400/40 bg-lime-400/5"
              : "border-red-500/40 bg-red-500/5"
          }`}
        >
          <p className="text-sm font-medium">{result.message}</p>
          {result.days && result.days.length > 0 && (
            <p className="mt-2 font-mono text-[11px] text-zinc-400">
              {result.days.join("  ·  ")}
            </p>
          )}
          {result.matched && result.matched.length > 0 && (
            <div className="mt-3 border-t border-zinc-800 pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                Matched
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {result.matched.map((m) => (
                  <li key={m.name} className="font-mono text-[11px]">
                    <span className="text-zinc-300">{m.name}</span>
                    <span className="text-zinc-600"> → </span>
                    <span
                      className={
                        m.source === "unresolved" ? "text-red-400" : "text-lime-400"
                      }
                    >
                      {m.muscle}
                    </span>
                    <span className="text-zinc-600"> ({m.source})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.unparsed && result.unparsed.length > 0 && (
            <div className="mt-3 border-t border-zinc-800 pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                Lines kept out of the set maths
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {result.unparsed.map((u) => (
                  <li key={u} className="font-mono text-[11px] text-zinc-500">
                    {u}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
                Usually time-based holds — nothing is lost, they just have no
                sets or reps to count.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

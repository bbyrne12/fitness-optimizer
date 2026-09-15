import { createClient } from "@/lib/supabase/server";
import { kindLabel, MIN_MEASURED } from "@/lib/athlete/decide";

type Cost = { value: number; n: number; source: string };

/**
 * What the athlete's own mornings have taught the engine each kind of day
 * costs: next-morning recovery points against what their own mean reversion
 * predicted, so it is relative to a typical day. Re-measured every morning.
 */
export async function LearnedCard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: prof } = await supabase
    .from("athlete_profile").select("config").eq("user_id", user.id).maybeSingle();
  const cfg = (prof?.config ?? {}) as Record<string, any>;
  const costs = (cfg.learned?.costs ?? {}) as Record<string, Cost>;
  const rows = Object.entries(costs)
    .filter(([, c]) => c.n >= 1)
    .map(([kind, c]) => ({ kind, label: kindLabel(kind), ...c }))
    .sort((a, b) => {
      const am = a.n >= MIN_MEASURED, bm = b.n >= MIN_MEASURED;
      if (am !== bm) return am ? -1 : 1;
      const ap = a.kind.includes("+"), bp = b.kind.includes("+");
      if (ap !== bp) return ap ? 1 : -1;
      return b.n - a.n;
    })
    .slice(0, 12);
  if (!rows.length) return null;

  const scale = Math.max(1, ...rows.map((r) => Math.abs(r.value)));

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">What your mornings have taught it</p>
      <p className="mt-1 text-sm leading-relaxed text-zinc-400">
        What each kind of day costs you the next morning, in recovery points, against a typical day.
        Measured from your own WHOOP history and re-measured every morning; the plan reads these numbers.
      </p>
      <table className="mt-4 w-full text-sm">
        <tbody>
          {rows.map((r) => {
            const learning = r.n < MIN_MEASURED;
            const pct = Math.round((Math.abs(r.value) / scale) * 100);
            return (
              <tr key={r.kind} className="border-t border-zinc-800">
                <td className={`py-2 pr-3 ${learning ? "text-zinc-500" : "text-zinc-200"}`}>{r.label}</td>
                <td className="w-[40%] py-2">
                  <div className="h-2 w-full rounded bg-zinc-800">
                    <div
                      className={`h-2 rounded ${r.value < 0 ? "bg-red-400/70" : "bg-lime-400/70"} ${learning ? "opacity-40" : ""}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </td>
                <td className={`w-16 py-2 pl-3 text-right font-mono text-[13px] ${
                  learning ? "text-zinc-500" : r.value < 0 ? "text-red-300" : "text-lime-300"}`}>
                  {r.value > 0 ? "+" : ""}{r.value.toFixed(1)}
                </td>
                <td className="w-24 py-2 pl-3 text-right font-mono text-[11px] text-zinc-600">
                  {learning ? `learning · ${r.n}` : `${r.n} days`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.some((r) => r.n < MIN_MEASURED) && (
        <p className="mt-3 text-[11px] text-zinc-600">
          Greyed rows have fewer than {MIN_MEASURED} measured mornings and still lean on the default.
        </p>
      )}
    </section>
  );
}

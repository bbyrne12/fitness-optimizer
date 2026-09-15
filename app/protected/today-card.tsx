import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

type Block = { title: string | null; note: string | null; items: string[] };

const LEVEL = {
  green: { badge: "GO", text: "text-lime-400", border: "border-lime-400", bg: "bg-lime-400/10" },
  yellow: { badge: "MODIFY", text: "text-amber-400", border: "border-amber-400", bg: "bg-amber-400/10" },
  red: { badge: "HOLD", text: "text-red-400", border: "border-red-400", bg: "bg-red-400/10" },
} as const;

/**
 * Today's decision, as the morning email carries it, for athletes who would
 * rather read it here. It is worked out from WHOOP every morning either way
 * and stored; this reads what was stored.
 */
export async function TodayCard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: row }, { data: prof }] = await Promise.all([
    supabase.from("decision_log").select("day,decision,emailed_at").eq("user_id", user.id)
      .order("day", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("athlete_profile").select("config").eq("user_id", user.id).maybeSingle(),
  ]);
  const cfg = (prof?.config ?? {}) as Record<string, any>;
  if (!cfg.goals && !cfg.week) return null;

  const offset = Number(cfg.utc_offset_minutes ?? 0);
  const today = new Date(Date.now() + offset * 60_000).toISOString().slice(0, 10);
  const d = (row?.decision ?? null) as Record<string, any> | null;
  const dec = d?.decision ?? null;
  const ses = d?.session ?? null;
  const isToday = row?.day === today;
  const lv = LEVEL[(dec?.level as keyof typeof LEVEL) ?? "green"] ?? LEVEL.green;
  const blocks: Block[] = ses?.blocks?.length ? ses.blocks : ses?.items ? [{ title: null, note: null, items: ses.items }] : [];

  return (
    <section className={`rounded-xl border ${isToday ? lv.border + "/40" : "border-zinc-800"} bg-zinc-900/40 p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          {isToday ? "Today" : row ? `Latest decision · ${row.day}` : "Today"}
          {d?.state?.recovery != null && (
            <span className={`ml-2 ${lv.text}`}>{lv.badge} · {Math.round(d.state.recovery)}%</span>
          )}
        </p>
        {row && !isToday && (
          <p className="text-[11px] text-zinc-500">
            Today&apos;s arrives once WHOOP scores your recovery.
          </p>
        )}
      </div>

      {!row ? (
        <p className="mt-3 text-sm text-zinc-400">
          Your first decision arrives the morning after WHOOP scores a recovery with a plan in place.
        </p>
      ) : (
        <>
          <h2 className={`mt-2 border-l-2 pl-3 text-2xl font-semibold text-white ${lv.border}`}>{dec?.call}</h2>
          {dec?.detail && <p className="mt-2 text-sm leading-relaxed text-zinc-400">{dec.detail}</p>}

          {blocks.length > 0 && (
            <div className="mt-4 space-y-3">
              {blocks.map((b, i) => (
                <div key={i}>
                  {b.title && (
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      {b.title}
                      {b.note && <span className="ml-2 normal-case tracking-normal text-zinc-600">{b.note}</span>}
                    </p>
                  )}
                  <ul className="mt-1 divide-y divide-zinc-800">
                    {b.items.map((it) => (
                      <li key={it} className="py-1.5 font-mono text-[13px] text-zinc-100">{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {ses?.add && (
            <div className={`mt-4 rounded-md border border-lime-400/30 ${LEVEL.green.bg} px-3 py-2`}>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-lime-400">Add today</p>
              <p className="mt-0.5 font-mono text-[13px] text-zinc-100">{ses.add.name} · {ses.add.dose}</p>
              <p className="mt-0.5 text-[12px] text-zinc-400">{ses.add.why}</p>
            </div>
          )}

          {Array.isArray(dec?.reasons) && dec.reasons.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer font-mono text-[11px] text-zinc-500 hover:text-zinc-300">Why</summary>
              <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-zinc-400">
                {dec.reasons.map((r: string) => <li key={r}>{r}</li>)}
              </ul>
            </details>
          )}

          <p className="mt-4 text-[11px] text-zinc-600">
            {row.emailed_at ? "Also sent by email." : "Not emailed: you chose to read it here."}{" "}
            <Link href="/calendar" className="text-zinc-400 hover:text-lime-300">This week&apos;s plan →</Link>
          </p>
        </>
      )}
    </section>
  );
}

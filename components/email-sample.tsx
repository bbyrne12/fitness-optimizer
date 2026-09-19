/**
 * The morning email, on the landing page. Same shape as lib/athlete/email.ts
 * sends: the day's call, the session in order, one addition, the block.
 * Invented data, so nobody's recovery is on the marketing page.
 */
const SAMPLES = {
  green: {
    date: "Sat 19 Sep",
    badge: "GO",
    recovery: 79,
    accent: "text-lime-400",
    bar: "border-lime-400",
    call: "Long run — 5.4 miles, easy.",
    blocks: [
      { title: null, note: null, items: ["Long run — 5.4 mi, under 148 bpm", "Strides — 6 x 20s fast, full recovery between"] },
      {
        title: "Core circuit",
        note: "Straight through, once. About 10 minutes.",
        items: ["Plank — 45 sec", "Dead bug — 3 x 10 each side", "Pallof press — 3 x 10 each side"],
      },
    ],
    add: {
      name: "Core circuit · 3 movements, about 10 min",
      why: "Core is one of your focus areas, and it fits on any day. Your own routine, as you last did it.",
    },
    hold: null,
  },
  hold: {
    date: "Thu 17 Sep",
    badge: "MODIFY",
    recovery: 45,
    accent: "text-amber-400",
    bar: "border-amber-400",
    call: "Basketball tonight — pace yourself.",
    blocks: [
      { title: null, note: null, items: ["Basketball — 7pm. That is the whole session."] },
    ],
    add: {
      name: "Slow breathing · 10 min at 6 breaths/min",
      why: "HRV has been below its band. Slow breathing is the best-evidenced way to raise RMSSD: 5-15 ms over 4-6 weeks.",
    },
    hold: "Hold the weights where they were today.",
  },
} as const;

export function EmailSample({ variant }: { variant: keyof typeof SAMPLES }) {
  const s = SAMPLES[variant];
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {s.date} · <span className={s.accent}>{s.badge} · {s.recovery}%</span>
      </p>
      <h3 className={`mt-3 border-l-2 pl-3 text-xl font-semibold leading-snug text-white ${s.bar}`}>
        {s.call}
      </h3>
      <div className="mt-4 space-y-3">
        {s.blocks.map((b, i) => (
          <div key={i}>
            {b.title && (
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">{b.title}</p>
            )}
            {b.note && <p className="text-[11px] text-zinc-600">{b.note}</p>}
            <ul className="mt-1 divide-y divide-zinc-800 border-t border-zinc-800">
              {b.items.map((it) => (
                <li key={it} className="py-2 font-mono text-[13px] text-zinc-100">{it}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {s.hold && <p className="mt-3 text-[12px] text-zinc-400">{s.hold}</p>}
      <div className="mt-4 rounded-md border border-lime-400/30 bg-lime-400/5 px-3 py-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-lime-400">Add today</p>
        <p className="mt-0.5 font-mono text-[13px] text-zinc-100">{s.add.name}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">{s.add.why}</p>
      </div>
    </div>
  );
}

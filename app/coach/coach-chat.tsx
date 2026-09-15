"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { coach, type ChatMessage } from "./actions";

type Shown = ChatMessage & { applied?: string[]; error?: string };

const STARTERS = [
  "Move my long run to Sunday",
  "I tweaked my shoulder, keep bench where it is",
  "Why is Thursday a pull day?",
  "Add basketball on Monday evenings",
];

export function CoachChat({ firstName }: { firstName: string }) {
  const [messages, setMessages] = useState<Shown[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, pending]);

  function send(text: string) {
    const t = text.trim();
    if (!t || pending) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: t }]);
    setDraft("");
    start(async () => {
      const r = await coach(history, t);
      setMessages((m) => [...m, {
        role: "assistant",
        content: r.error ?? r.reply,
        applied: r.applied.length ? r.applied : undefined,
        error: r.error,
      }]);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="min-h-[320px] space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-zinc-400">
              Tell the coach what should change, {firstName}, or ask why the plan does something.
              Changes are saved to your plan straight away and show up in tomorrow&apos;s decision.
            </p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)}
                  className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 transition hover:border-lime-400/60 hover:text-lime-300">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
              m.role === "user" ? "bg-lime-400 text-zinc-950"
              : m.error ? "border border-red-500/40 bg-red-500/5 text-red-200"
              : "border border-zinc-800 bg-zinc-950 text-zinc-100"}`}>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.applied && (
                <ul className="mt-2 space-y-0.5 border-t border-zinc-800 pt-2">
                  {m.applied.map((a) => (
                    <li key={a} className="font-mono text-[11px] text-lime-400">✓ {a}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-500">Thinking…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(draft); }}
        className="flex gap-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What should change?"
          disabled={pending}
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-lime-400/50 focus:outline-none focus:ring-1 focus:ring-lime-400/40 disabled:opacity-50"
        />
        <button type="submit" disabled={pending || !draft.trim()}
          className="rounded-md bg-lime-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-lime-300 disabled:opacity-50">
          Send
        </button>
      </form>
    </div>
  );
}

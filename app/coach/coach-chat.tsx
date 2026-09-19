"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Check } from "lucide-react";

import { coach, type ChatMessage } from "./actions";

type Shown = ChatMessage & { applied?: string[]; error?: string };

const STARTERS = [
  "Why is Wednesday a pull day?",
  "I tweaked my knee, keep squats where they are",
  "Move my long run to Sunday",
  "Add basketball on Monday evenings",
];

export function CoachChat({ firstName }: { firstName: string }) {
  const [messages, setMessages] = useState<Shown[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (messages.length || pending) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  // The composer grows with the message instead of scrolling inside itself.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
    // Only scrolls once it has grown as far as it may.
    el.style.overflowY = el.scrollHeight > 180 ? "auto" : "hidden";
  }, [draft]);

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
    <div className="flex flex-col gap-8">
      {messages.length === 0 ? (
        <div className="space-y-4">
          <p className="text-[15px] leading-relaxed text-zinc-400">
            Tell the coach what should change, {firstName}, or ask why the plan does
            something. Anything you agree to is saved straight away.
          </p>
          <div className="flex flex-wrap gap-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3.5 py-2 text-[13px] text-zinc-300 transition-colors hover:border-lime-400/50 hover:text-lime-300"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-lime-400 px-4 py-2.5 text-[15px] leading-relaxed text-zinc-950">
                  {m.content}
                </p>
              </div>
            ) : (
              <div key={i} className="flex flex-col gap-3">
                {m.error ? (
                  // Not the coach talking: something went wrong, said quietly.
                  <p className="rounded-xl border border-red-500/25 bg-red-500/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-red-300">
                    {m.content}
                  </p>
                ) : (
                  <p className="max-w-[92%] whitespace-pre-wrap text-[15px] leading-[1.65] text-zinc-100">
                    {m.content}
                  </p>
                )}
                {m.applied && (
                  <ul className="flex flex-wrap gap-2">
                    {m.applied.map((a) => (
                      <li
                        key={a}
                        className="inline-flex items-center gap-1.5 rounded-full border border-lime-400/25 bg-lime-400/10 px-3 py-1 text-[12px] text-lime-300"
                      >
                        <Check className="h-3 w-3 shrink-0" strokeWidth={3} />
                        {a}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          )}
          {pending && (
            <div className="flex gap-1.5 pt-1" aria-label="Thinking">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-600"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); send(draft); }}
        className="sticky bottom-4 z-10"
      >
        <div className="relative rounded-3xl border border-zinc-800 bg-zinc-900/90 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.9)] backdrop-blur transition-colors focus-within:border-lime-400/40">
          <textarea
            ref={boxRef}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); }
            }}
            placeholder="What should change?"
            disabled={pending}
            className="max-h-44 w-full resize-none overflow-hidden rounded-3xl bg-transparent py-3.5 pl-5 pr-14 text-[15px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            aria-label="Send"
            className="absolute bottom-2.5 right-2.5 grid h-9 w-9 place-items-center rounded-full bg-lime-400 text-zinc-950 transition hover:bg-lime-300 disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            <ArrowUp className="h-4.5 w-4.5" strokeWidth={2.5} />
          </button>
        </div>
        <p className="mt-2 px-1 text-[11px] text-zinc-600">
          Enter sends · Shift + Enter for a new line
        </p>
      </form>
    </div>
  );
}

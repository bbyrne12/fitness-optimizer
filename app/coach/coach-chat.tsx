"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Check } from "lucide-react";

import Link from "next/link";

import { coach, type ChatMessage } from "./actions";
import { RichText } from "./rich-text";
import { DEMO_SAMPLE, DEMO_SAMPLE_RECORDED, DEMO_STARTERS, type DemoLimit } from "./demo-content";

type Shown = ChatMessage & { applied?: string[]; error?: string };

const STARTERS = [
  "Why is Wednesday a pull day?",
  "I tweaked my knee, keep squats where they are",
  "Move my long run to Sunday",
  "Add basketball on Monday evenings",
];

export function CoachChat({ firstName, demo = false }: { firstName: string; demo?: boolean }) {
  const [messages, setMessages] = useState<Shown[]>([]);
  const [limit, setLimit] = useState<DemoLimit | null>(null);
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
      if (r.limited) {
        // Not answered, so not left hanging in the conversation. A long
        // conversation keeps the question ready for a fresh one.
        setMessages((m) => m.slice(0, -1));
        if (r.limited === "turns") setDraft(t);
        setLimit(r.limited);
        return;
      }
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
            {(demo ? DEMO_STARTERS : STARTERS).map((s) => (
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
                  <div className="max-w-[92%] space-y-3 text-[15px] leading-[1.65] text-zinc-100">
                    <RichText text={m.content} />
                  </div>
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

      {limit === "turns" && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3.5 text-[14px] leading-relaxed text-zinc-300">
          That&apos;s as long as a demo conversation goes. Start a fresh one and your question will be waiting.
          <button
            type="button"
            onClick={() => { setMessages([]); setLimit(null); }}
            className="ml-2 font-medium text-lime-400 hover:text-lime-300"
          >
            New conversation
          </button>
        </div>
      )}

      {limit && limit !== "turns" ? <DemoLimitPanel limit={limit} /> : (
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
      )}
    </div>
  );
}

/** What a reviewer sees when the demo coach is out of messages: no error, a
 *  plain explanation, and a real conversation with the same demo athlete so
 *  the coach can still be judged. */
function DemoLimitPanel({ limit }: { limit: DemoLimit }) {
  const why = limit === "visitor"
    ? "You've used today's messages for the demo."
    : "It has had a busy day with other visitors.";
  return (
    <section className="space-y-6 rounded-2xl border border-lime-400/20 bg-lime-400/[0.04] p-5">
      <div className="space-y-1.5">
        <h2 className="text-[15px] font-semibold text-white">The demo coach has hit its limit for today</h2>
        <p className="text-[14px] leading-relaxed text-zinc-400">
          {why} Here is a real conversation with this same demo athlete, so you can still see what it
          does. The plan itself is still yours to change on the{" "}
          <Link href="/athlete" className="text-lime-400 hover:text-lime-300">Setup</Link> page.
        </p>
      </div>
      {DEMO_SAMPLE.length > 0 && (
        <div className="flex flex-col gap-5 border-t border-zinc-800/80 pt-5">
          {DEMO_SAMPLE.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-lime-400 px-4 py-2.5 text-[15px] leading-relaxed text-zinc-950">
                  {m.content}
                </p>
              </div>
            ) : (
              <div key={i} className="flex flex-col gap-3">
                <div className="max-w-[92%] space-y-3 text-[15px] leading-[1.65] text-zinc-100"><RichText text={m.content} /></div>
                {m.applied && (
                  <ul className="flex flex-wrap gap-2">
                    {m.applied.map((a) => (
                      <li key={a} className="inline-flex items-center gap-1.5 rounded-full border border-lime-400/25 bg-lime-400/10 px-3 py-1 text-[12px] text-lime-300">
                        <Check className="h-3 w-3 shrink-0" strokeWidth={3} />
                        {a}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          )}
          {DEMO_SAMPLE_RECORDED && (
            <p className="text-[11px] text-zinc-600">Recorded {DEMO_SAMPLE_RECORDED}. Back tomorrow for your own.</p>
          )}
        </div>
      )}
    </section>
  );
}

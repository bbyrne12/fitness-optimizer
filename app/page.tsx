import Link from "next/link";
import { ArrowRight, Activity, BarChart3, MessageSquare, NotebookPen } from "lucide-react";

import { EmailSample } from "@/components/email-sample";
import { Logo } from "@/components/logo";

const FEATURES = [
  {
    icon: Activity,
    title: "One call each morning",
    description:
      "Once WHOOP scores your recovery, an email says what to train today, how hard, and at what loads. The lines between easy and hard are your own, learned from your own spread of mornings, and the session scales with the actual number: 71% and 45% are both a modified day, and they are not the same one.",
  },
  {
    icon: BarChart3,
    title: "It learns what things cost you",
    description:
      "Every kind of day is priced from your own history: the next morning's recovery against a rest day, with that night's sleep held equal. Runs are sorted by your own heart-rate zones, not by how long they were.",
  },
  {
    icon: MessageSquare,
    title: "A coach you can argue with",
    description:
      "Move your long run, add a sport, flag a sore shoulder, or ask why Thursday is a pull day. It knows your plan and your last three weeks, and changes the plan as you agree to it.",
  },
  {
    icon: NotebookPen,
    title: "Logging stays the way you write it",
    description:
      "Paste the workout straight out of your notes app. Loads carry into the next session of that kind and go up when you have earned them.",
  },
];

const STEPS = [
  {
    number: "01",
    title: "Connect WHOOP",
    description:
      "One tap, then WHOOP's own login. Your history is read once, so the plan knows what each sport costs you before the first email.",
  },
  {
    number: "02",
    title: "Answer eight questions",
    description:
      "What you are training for, how many days you lift and run, the sports already on your calendar, and anything sore.",
  },
  {
    number: "03",
    title: "Train what the morning says",
    description:
      "The week is built around your practices and your long run, then each morning is adjusted to the recovery you actually woke up with.",
  },
];

const SHOTS = [
  {
    src: "/screenshots/training-plan.png",
    alt: "The training plan: weeks laid out to a race date",
    title: "The plan",
    caption: "Your weeks to the race, built around the sports you already play.",
  },
  {
    src: "/screenshots/workout-journal.png",
    alt: "The workout journal: a calendar of logged sessions",
    title: "The journal",
    caption: "Every session you have logged, and where the next loads come from.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white antialiased">
      <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
        <header className="absolute inset-x-0 top-0 z-20 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
          <Logo markClassName="h-6 w-6" />
          <Link href="/auth/login" className="text-sm font-medium text-zinc-400 transition-colors hover:text-white">
            Sign in
          </Link>
        </header>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background:radial-gradient(60%_50%_at_50%_30%,rgba(163,230,53,0.08),transparent_70%)]"
        />
        <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center text-center">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-lime-400" />
            Built on the WHOOP API
          </span>
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl md:text-7xl lg:text-8xl">
            One decision,
            <br />
            <span className="text-lime-400">every morning.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base text-zinc-400 sm:text-lg md:text-xl">
            Fitness Optimizer reads your WHOOP recovery when you wake up and emails
            one prescription for the day: what to train, how hard, and at what loads.
            Nothing to interpret.
          </p>

          <div className="mt-10 flex w-full flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/auth/sign-up"
              className="group relative inline-flex items-center justify-center gap-2 rounded-full bg-lime-400 px-8 py-3 font-semibold text-zinc-950 shadow-[0_0_40px_-8px_rgba(163,230,53,0.6)] ring-1 ring-lime-300/60 transition-all hover:bg-lime-300 hover:shadow-[0_0_60px_-8px_rgba(163,230,53,0.8)]"
            >
              Get Started Free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/auth/login"
              className="inline-flex items-center justify-center rounded-full border border-zinc-700 px-8 py-3 font-semibold text-white transition-colors hover:border-zinc-500"
            >
              Sign In
            </Link>
          </div>

          <p className="mt-5 text-xs text-zinc-500">
            Free. A WHOOP membership is what it reads from.
          </p>
          <Link
            href="/auth/login?demo=1"
            className="mt-3 text-sm text-zinc-400 underline-offset-4 transition-colors hover:text-lime-300 hover:underline"
          >
            No WHOOP? See it with sample data
          </Link>
        </div>
      </section>

      <section className="border-t border-zinc-900 px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
              Your recovery, turned into a session.
            </h2>
            <p className="mt-4 text-base text-zinc-400 md:text-lg">
              WHOOP tells you how recovered you are. This tells you what to do about
              it, in the sport and the lifts you already train.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="group rounded-2xl border border-zinc-800 bg-zinc-900 p-6 transition-colors hover:border-zinc-700"
              >
                <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-lime-400/20 bg-lime-400/10">
                  <Icon className="h-5 w-5 text-lime-400" strokeWidth={2.25} />
                </div>
                <h3 className="text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-900 px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
              What it looks like
            </h2>
            <p className="mt-4 text-base text-zinc-400 md:text-lg">
              Two mornings: one where the session goes ahead, one where recovery says
              hold back. Sample data, not a real member&apos;s.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <EmailSample variant="green" />
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                <span className="font-semibold text-white">A good morning.</span>{" "}
                79% recovered, so the long run goes ahead at full distance, with the
                core routine they already do.
              </p>
            </div>
            <div>
              <EmailSample variant="hold" />
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                <span className="font-semibold text-white">A bad one.</span>{" "}
                45% and sleep debt: the session stays, the intensity comes off, weights
                hold where they were, and breathing work is added because HRV has been low.
              </p>
            </div>
          </div>

          <figure className="mt-10">
            <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/screenshots/coach.png"
                alt="The coach diagnosing a tired long run, proposing a change, and applying it"
                loading="lazy"
                className="w-full"
              />
            </div>
            <figcaption className="mt-3 text-sm leading-relaxed text-zinc-400">
              <span className="font-semibold text-white">The coach.</span>{" "}
              It reads the week, points at the session that actually costs this athlete
              the most, proposes one fix, and makes the change once they agree.
            </figcaption>
          </figure>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
            {SHOTS.map(({ src, alt, title, caption }) => (
              <figure key={src} className="flex flex-col">
                <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={alt}
                    loading="lazy"
                    className="h-[360px] w-full object-cover object-top"
                  />
                </div>
                <figcaption className="mt-3 text-sm leading-relaxed text-zinc-400">
                  <span className="font-semibold text-white">{title}.</span>{" "}
                  {caption}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-900 px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
              How it works
            </h2>
            <p className="mt-4 text-base text-zinc-400 md:text-lg">
              Connect once. The first email arrives the next morning WHOOP scores you.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-10">
            {STEPS.map(({ number, title, description }) => (
              <div key={number} className="relative">
                <div className="font-mono text-5xl font-bold tracking-tight text-lime-400 md:text-6xl">
                  {number}
                </div>
                <h3 className="mt-4 text-xl font-bold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400 md:text-base">
                  {description}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-10 max-w-3xl text-sm leading-relaxed text-zinc-500">
            Recovery, sleep, cycles and workouts come from the WHOOP API over your own
            OAuth grant, and are only ever read. Disconnecting on the setup page deletes
            the stored tokens, and each athlete sees only their own data.
          </p>
        </div>
      </section>

      <section className="px-6 py-16 md:py-24">
        <div className="mx-auto max-w-5xl rounded-3xl border border-zinc-800 bg-zinc-900 px-6 py-16 text-center md:py-20">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
            Stop guessing at 6am.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-zinc-400 md:text-lg">
            Connect WHOOP, answer eight questions, and read one line tomorrow morning.
          </p>
          <div className="mt-8 flex justify-center">
            <Link
              href="/auth/sign-up"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-lime-400 px-8 py-3 font-semibold text-zinc-950 transition-colors hover:bg-lime-300"
            >
              Start for Free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-900 px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-center text-xs text-zinc-500 sm:flex-row sm:text-left">
          <Logo className="opacity-80" markClassName="h-5 w-5" />
          <span>
            Not affiliated with WHOOP. Training guidance, not medical advice.
          </span>
          <Link href="/privacy" className="hover:text-zinc-300">
            Privacy
          </Link>
          <span>2026</span>
        </div>
      </footer>
    </main>
  );
}

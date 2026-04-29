import Link from "next/link";
import { ArrowRight, BarChart3, Dumbbell, Sparkles } from "lucide-react";

const FEATURES = [
  {
    icon: Dumbbell,
    title: "Routine Analysis",
    description:
      "Identify muscle imbalances and volume gaps in your current training.",
  },
  {
    icon: Sparkles,
    title: "Smart Weekly Plans",
    description:
      "AI-generated workout plans tailored to your goals, experience, and available equipment.",
  },
  {
    icon: BarChart3,
    title: "Track Progress",
    description:
      "Log every workout and watch your strength and consistency trend upward.",
  },
];

const STEPS = [
  {
    number: "01",
    title: "Tell us your goals",
    description:
      "Set your experience level, available equipment, and training schedule.",
  },
  {
    number: "02",
    title: "Log your routine",
    description:
      "Add the exercises you currently do so we can analyze your training.",
  },
  {
    number: "03",
    title: "Get your plan",
    description:
      "Receive a personalized weekly plan that addresses your weaknesses.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white antialiased">
      <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background:radial-gradient(60%_50%_at_50%_30%,rgba(163,230,53,0.08),transparent_70%)]"
        />
        <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center text-center">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-lime-400" />
            Fitness Optimizer
          </span>
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl md:text-7xl lg:text-8xl">
            Train Smarter.
            <br />
            <span className="text-lime-400">Recover Better.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base text-zinc-400 sm:text-lg md:text-xl">
            A personalized fitness optimizer that analyzes your routine, fixes
            imbalances, and builds your weekly plan.
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

          <p className="mt-5 text-xs text-zinc-500">No credit card required</p>
        </div>
      </section>

      <section className="border-t border-zinc-900 px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
              Built for athletes who want results.
            </h2>
            <p className="mt-4 text-base text-zinc-400 md:text-lg">
              Every feature is designed to remove guesswork from your training.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
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
              How it works
            </h2>
            <p className="mt-4 text-base text-zinc-400 md:text-lg">
              From signup to your first optimized week in minutes.
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
        </div>
      </section>

      <section className="px-6 py-16 md:py-24">
        <div className="mx-auto max-w-5xl rounded-3xl border border-zinc-800 bg-zinc-900 px-6 py-16 text-center md:py-20">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
            Ready to optimize your training?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-zinc-400 md:text-lg">
            Join now and get a personalized weekly plan today.
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
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-xs text-zinc-500 sm:flex-row">
          <span className="font-semibold tracking-tight text-zinc-400">
            Fitness Optimizer
          </span>
          <span className="text-center">
            Built for CS 2053 · Villanova University
          </span>
          <span>2026</span>
        </div>
      </footer>
    </main>
  );
}

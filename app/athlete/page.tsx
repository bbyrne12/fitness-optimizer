/**
 * /athlete -- one athlete's setup: their WHOOP connection, then the questions
 * the plan is built from.
 */
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { createClient } from "@/lib/supabase/server";
import { planInputs } from "@/lib/athlete/decide";
import { connectionStatus } from "@/lib/athlete/whoop";

import { disconnectWhoop } from "./actions";
import { SetupForm, type SetupDefaults, type SportSeen } from "./setup-form";

export const metadata = { title: "Athlete setup" };

const NOTICES: Record<string, { ok: boolean; text: string }> = {
  connected: {
    ok: true,
    text: "WHOOP is connected. Your sports and what each one costs you are below; the first morning email goes out once WHOOP scores your next recovery.",
  },
  denied: { ok: false, text: "WHOOP access was not approved, so nothing was connected." },
  state: {
    ok: false,
    text: "That connection attempt expired or came back to a different browser. Start it again.",
  },
  failed: {
    ok: false,
    text: "WHOOP did not accept the connection. Try again; if it keeps failing, this site's callback URL is not registered on the WHOOP app.",
  },
  unavailable: { ok: false, text: "WHOOP connections are not configured on this deployment yet." },
};

const ADVANCED_KEYS = ["cues", "additions", "tunables", "cadence_spm"];

const primaryBtn =
  "inline-block rounded-md bg-lime-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-lime-300";
const quietBtn =
  "inline-block rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-700 hover:text-white";

type Search = Promise<{ whoop?: string }>;

export default function AthletePage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppNav />
      <main className="min-h-screen w-full px-4 py-10">
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <header className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-lime-400">
              Athlete setup
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Your morning decision
            </h1>
            <p className="text-sm leading-relaxed text-zinc-400">
              Connect WHOOP and answer a few questions. Every morning, once WHOOP
              scores your recovery, you get one email: what to train today, and how hard.
            </p>
          </header>

          <Suspense
            fallback={
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                Loading…
              </p>
            }
          >
            <AthleteBody searchParams={searchParams} />
          </Suspense>
        </div>
      </main>
    </>
  );
}

async function AthleteBody({ searchParams }: { searchParams: Search }) {
  const { whoop } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [{ data: prof }, status] = await Promise.all([
    supabase.from("athlete_profile").select("config").eq("user_id", user.id).maybeSingle(),
    connectionStatus(user.id),
  ]);
  const cfg = (prof?.config ?? {}) as Record<string, any>;
  const answered = Boolean(cfg.goals || cfg.race);
  const inputs = planInputs(cfg);
  const notice = whoop ? NOTICES[whoop] : undefined;

  const summary = (cfg.whoop_summary ?? {}) as Record<string, any>;
  const sportsSeen: SportSeen[] = Array.isArray(summary.sports) ? summary.sports : [];
  const maxHr = Number(summary.max_heart_rate);
  const restingHr = Number(summary.resting_heart_rate);
  // WHOOP's heart-rate zones run on heart-rate reserve; zone 2 tops out at 70% of it.
  const zone2Suggestion = maxHr > 0 && restingHr > 0
    ? Math.round(restingHr + 0.7 * (maxHr - restingHr))
    : null;

  const advanced: Record<string, unknown> = {};
  for (const k of ADVANCED_KEYS) if (cfg[k] !== undefined) advanced[k] = cfg[k];

  const defaults: SetupDefaults = {
    goal: answered ? inputs.goal : "",
    raceDistance: inputs.race?.distance ?? "",
    raceDate: inputs.race?.date ?? "",
    raceName: cfg.goals?.race?.name ?? cfg.race?.name ?? "",
    liftDays: inputs.liftDays,
    runDays: inputs.runDays,
    longRunDay: inputs.longRunDay,
    activities: inputs.activities.map((a) => ({
      sport: a.sport, label: a.label, days: a.days, time: a.time ?? "", intensity: a.intensity,
    })),
    zone2: cfg.athlete?.zone2_ceiling_bpm ?? "",
    longestRunMi: inputs.longestRunMi || "",
    manualLifts: (Array.isArray(cfg.manual_lifts) ? cfg.manual_lifts : []).join(", "),
    emailTo: cfg.email_to ?? "",
    advanced: Object.keys(advanced).length ? JSON.stringify(advanced, null, 2) : "",
  };
  const ready = status.connected && answered;

  return (
    <>
      {notice && (
        <div
          className={`rounded-md border p-4 text-sm text-zinc-200 ${
            notice.ok ? "border-lime-400/40 bg-lime-400/5" : "border-red-500/40 bg-red-500/5"
          }`}
        >
          {notice.text}
        </div>
      )}

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Step 1</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">
              WHOOP{" "}
              <span className={status.connected ? "text-lime-400" : "text-zinc-500"}>
                · {status.connected ? "connected" : "not connected"}
              </span>
            </h2>
            <p className="mt-1 max-w-md text-sm text-zinc-400">
              {status.connected
                ? "Recovery, sleep, cycles and workouts are read each morning. Nothing is written back to WHOOP."
                : "You sign in on WHOOP's own page and approve read access. Connect first and the questions below can use your history."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* A plain link on purpose: this leaves the site for WHOOP. */}
            <a href="/api/whoop/connect" className={status.connected ? quietBtn : primaryBtn}>
              {status.connected ? "Reconnect" : "Connect WHOOP"}
            </a>
            {status.connected && (
              <form action={disconnectWhoop}>
                <button type="submit" className={quietBtn}>Disconnect</button>
              </form>
            )}
          </div>
        </div>
      </section>

      <div className="pt-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Step 2</p>
        <h2 className="mt-1 text-lg font-semibold text-white">Build your plan</h2>
        <p className="mt-1 text-sm text-zinc-400">
          {ready
            ? `You're set: the morning email goes to ${cfg.email_to || user.email}. Change any answer and tomorrow's plan follows it.`
            : "Seven questions. Each one changes the week the plan builds."}
        </p>
      </div>

      <SetupForm
        key={JSON.stringify(defaults)}
        defaults={defaults}
        accountEmail={user.email ?? ""}
        sportsSeen={sportsSeen}
        zone2Suggestion={zone2Suggestion}
      />
    </>
  );
}

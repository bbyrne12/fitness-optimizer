/**
 * /athlete -- one athlete's setup: their WHOOP connection and the profile the
 * morning decision is built from.
 */
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { createClient } from "@/lib/supabase/server";
import { connectionStatus } from "@/lib/athlete/whoop";

import { disconnectWhoop } from "./actions";
import { SetupForm, type SetupDefaults } from "./setup-form";

export const metadata = { title: "Athlete setup" };

const NOTICES: Record<string, { ok: boolean; text: string }> = {
  connected: {
    ok: true,
    text: "WHOOP is connected. The first morning email goes out once WHOOP scores your next recovery.",
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

const ADVANCED_KEYS = ["cues", "additions", "manual_lifts", "tunables", "cadence_spm"];

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
              Connect WHOOP and set a race. Every morning, once WHOOP scores your
              recovery, you get one email: what to train today, and how hard.
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
  const notice = whoop ? NOTICES[whoop] : undefined;

  const advanced: Record<string, unknown> = {};
  for (const k of ADVANCED_KEYS) if (cfg[k] !== undefined) advanced[k] = cfg[k];

  const defaults: SetupDefaults = {
    emailTo: cfg.email_to ?? "",
    raceName: cfg.race?.name ?? "Half marathon",
    raceDate: cfg.race?.date ?? "",
    longestRunMi: cfg.race?.longest_run_ever_mi ?? "",
    zone2: cfg.athlete?.zone2_ceiling_bpm ?? "",
    lacrosseDays: cfg.lacrosse?.days ?? [],
    lacrosseTime: cfg.lacrosse?.time ?? "",
    tennisDays: cfg.tennis?.days ?? [],
    advanced: Object.keys(advanced).length ? JSON.stringify(advanced, null, 2) : "",
  };
  const ready = status.connected && Boolean(cfg.race?.date);

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
                : "You sign in on WHOOP's own page and approve read access to recovery, sleep, cycles and workouts."}
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

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Step 2</p>
        <h2 className="mt-1 text-lg font-semibold text-white">Training profile</h2>
        <SetupForm
          key={JSON.stringify(defaults)}
          defaults={defaults}
          accountEmail={user.email ?? ""}
        />
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Then</p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          {ready
            ? `You're set. The morning email goes to ${cfg.email_to || user.email} once WHOOP scores your recovery.`
            : "Once WHOOP is connected and a race date is saved, the morning email starts on its own."}{" "}
          Log lifts in the Workout Journal so the plan knows what you actually did.
        </p>
      </section>
    </>
  );
}

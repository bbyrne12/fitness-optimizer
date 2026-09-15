import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppNav } from "@/components/app-nav";
import { createClient } from "@/lib/supabase/server";

import { CoachChat } from "./coach-chat";

async function CoachContent() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: prof } = await supabase
    .from("athlete_profile").select("config").eq("user_id", user.id).maybeSingle();
  const cfg = (prof?.config ?? null) as Record<string, unknown> | null;
  const hasPlan = Boolean(cfg && (cfg.goals || cfg.week || cfg.activities));

  if (!hasPlan) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-400">
        The coach works on your plan, so it needs one first.{" "}
        <Link href="/athlete" className="text-lime-400 hover:underline">Answer the setup questions</Link>{" "}
        and come back.
      </div>
    );
  }

  const firstName = user.email ? user.email.split("@")[0] : "there";
  return <CoachChat firstName={firstName} />;
}

export default function CoachPage() {
  return (
    <>
      <AppNav />
      <main className="min-h-screen w-full px-4 py-10">
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <header className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-lime-400">Coach</p>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Adjust your plan</h1>
            <p className="text-sm text-zinc-400">
              Say it the way you would to a coach. Anything you agree to is saved to your plan.
              The setup page still shows every setting if you would rather edit directly.
            </p>
          </header>
          <Suspense fallback={<div className="h-80 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900" />}>
            <CoachContent />
          </Suspense>
        </div>
      </main>
    </>
  );
}

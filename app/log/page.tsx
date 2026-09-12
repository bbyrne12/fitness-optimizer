import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { PasteLog } from "@/components/paste-log";
import { isAthleteOwner } from "@/lib/athlete/owner";

// The paste box writes to one person's athlete_sets; nobody else has a use for it.
async function OwnerOnly() {
  if (!(await isAthleteOwner())) redirect("/log-workout");
  return <PasteLog />;
}

export default function LogPage() {
  return (
    <>
      <AppNav />
      <main className="min-h-screen w-full px-4 py-10">
        <div className="mx-auto w-full max-w-2xl">
          <Suspense fallback={null}>
            <OwnerOnly />
          </Suspense>
        </div>
      </main>
    </>
  );
}

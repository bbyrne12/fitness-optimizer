import Link from "next/link";
import type { Metadata } from "next";

const CONTACT = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "bradleysbyrne@gmail.com";
const UPDATED = "19 September 2026";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What Fitness Optimizer collects, what it does with it, who it is shared with, and how to get it deleted.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-zinc-900 py-8">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-400">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-16 text-white antialiased">
      <div className="mx-auto w-full max-w-2xl">
        <Link href="/" className="font-mono text-[11px] uppercase tracking-[0.18em] text-lime-400 hover:underline">
          ← Fitness Optimizer
        </Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">Privacy</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Fitness Optimizer is a personal training app. It reads your WHOOP data with
          your permission, turns it into a daily training decision for you, and shows
          that decision to you alone. Last updated {UPDATED}.
        </p>

        <Section title="What is collected">
          <p>
            <strong className="text-zinc-200">Your account.</strong> The email address
            you sign up with, and a password stored as a hash by Supabase Auth. Nothing
            else is asked for.
          </p>
          <p>
            <strong className="text-zinc-200">WHOOP data, if you connect WHOOP.</strong>{" "}
            Recovery scores, sleep, daily cycles, workouts, and body measurements such
            as max heart rate, read through the WHOOP API using the access you grant on
            WHOOP&apos;s own consent screen. Data is only ever read. Nothing is written
            back to WHOOP, and no WHOOP data about anyone else is ever requested.
          </p>
          <p>
            <strong className="text-zinc-200">What you enter.</strong> Your training
            settings, the workouts you log or paste, and any notes you write.
          </p>
        </Section>

        <Section title="What it is used for">
          <p>
            One purpose: producing your training plan and your daily decision, and
            showing it to you in the app or by email. Recovery figures are also used to
            estimate what each kind of session costs you, which is how the plan adapts.
          </p>
          <p>
            Your data is never used to advertise, is never sold or licensed, and is
            never shown to another user. Every database table is protected by row-level
            security, so one account cannot read another&apos;s rows.
          </p>
        </Section>

        <Section title="Who else touches it">
          <p>
            <strong className="text-zinc-200">Supabase</strong> hosts the database and
            handles sign-in. <strong className="text-zinc-200">Vercel</strong> hosts and
            runs the app. Both act as processors for this app.
          </p>
          <p>
            <strong className="text-zinc-200">Email delivery.</strong> If you choose the
            morning email, its contents are sent through an email provider to your
            address. You can turn the email off in Setup and read the decision in the
            app instead.
          </p>
          <p>
            <strong className="text-zinc-200">Anthropic</strong> processes two features
            you choose to use: the Coach conversation, and reading your free-text notes
            into plan settings. When you use them, the text you write plus the relevant
            parts of your plan and recent training, including recovery figures, are sent
            to Anthropic&apos;s API to produce the reply. If you never open the Coach and
            never write notes, nothing is sent there.
          </p>
          <p>
            Nobody else receives your data. There is no analytics or advertising code on
            this site.
          </p>
        </Section>

        <Section title="How long it is kept, and how to remove it">
          <p>
            Your data is kept while your account exists, because the plan works from your
            own history.
          </p>
          <p>
            <strong className="text-zinc-200">Disconnecting WHOOP</strong> on the Setup
            page deletes the stored WHOOP tokens immediately and stops all further
            reading.
          </p>
          <p>
            <strong className="text-zinc-200">Deleting everything.</strong> Email{" "}
            <a className="text-lime-400 hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>{" "}
            from the address on the account and everything held for you, including
            WHOOP-derived data, is deleted within seven days.
          </p>
          <p>
            <strong className="text-zinc-200">Getting a copy.</strong> Ask at the same
            address and your data is sent to you in a machine-readable form.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Traffic runs over HTTPS and data is encrypted at rest by Supabase. WHOOP
            tokens are held in a table no browser session can read; only the server can
            use them. The app is open source, so the handling described here can be
            checked in the code.
          </p>
        </Section>

        <Section title="Contact, and what this is not">
          <p>
            Questions, corrections or deletion requests:{" "}
            <a className="text-lime-400 hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>
          <p>
            Fitness Optimizer is an independent project and is not affiliated with,
            endorsed by, or sponsored by WHOOP. It gives training guidance, not medical
            advice, and it is not a medical device. Talk to a clinician about symptoms,
            injuries or health decisions.
          </p>
        </Section>

        <p className="border-t border-zinc-900 py-8 text-xs text-zinc-600">
          If this policy changes, the date at the top changes with it, and anything that
          widens what is collected or who receives it will be announced by email first.
        </p>
      </div>
    </main>
  );
}

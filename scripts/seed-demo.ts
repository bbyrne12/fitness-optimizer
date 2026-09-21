/**
 * Builds a demo athlete: an account with invented training data, so a
 * reviewer can sign in and see the app working without a WHOOP membership
 * and without anyone's real data.
 *
 *   DEMO_EMAIL=demo@example.com DEMO_PASSWORD='...' npx tsx scripts/seed-demo.ts
 *
 * Idempotent: running it again rebuilds the demo account as of today. The data
 * itself lives in lib/athlete/demo-seed.ts, which /api/demo/reset also runs
 * every night, so this script is only needed to create the account or change
 * its password.
 * The demo has no WHOOP tokens, so the morning job never touches it, and its
 * profile asks for no email, so nothing is ever sent from it.
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

import { writeDemo } from "../lib/athlete/demo-seed";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) process.env[line.slice(0, i)] ??= line.slice(i + 1).replace(/^"|"$/g, "");
}

const EMAIL = process.env.DEMO_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Set DEMO_EMAIL and DEMO_PASSWORD, e.g.\n  DEMO_EMAIL=demo@yourdomain.com DEMO_PASSWORD='choose-one' npx tsx scripts/seed-demo.ts");
  process.exit(1);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function main() {
  const { data: list } = await db.auth.admin.listUsers({ perPage: 200 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === EMAIL!.toLowerCase());
  let userId: string;
  if (existing) {
    userId = existing.id;
    const { error } = await db.auth.admin.updateUserById(userId, { password: PASSWORD, email_confirm: true });
    if (error) throw new Error(`could not update the demo account: ${error.message}`);
    console.log(`demo account exists (${userId}); password reset`);
  } else {
    const { data, error } = await db.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`could not create the demo account: ${error?.message}`);
    userId = data.user.id;
    console.log(`demo account created (${userId})`);
  }

  const r = await writeDemo(db, userId);
  console.log(`seeded ${r.sets} logged sets across ${r.days} days, and ${r.decisions} daily decisions ending today.`);
  console.log(`sign in at /auth/login as ${EMAIL}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

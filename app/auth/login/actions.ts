"use server";

/**
 * The demo account's login, for the "fill in the demo account" button.
 *
 * Handed over on request rather than written into the page, so the address
 * and password are not sitting in every copy of the HTML for anything that
 * scrapes it. They are not secret: the account holds invented data, its
 * record is read-only, and its plan resets nightly (lib/athlete/demo.ts).
 * Set DEMO_EMAIL and DEMO_PASSWORD on the deployment; without them the
 * button does not appear.
 */
export async function demoLogin(): Promise<{ email: string; password: string } | null> {
  const email = process.env.DEMO_EMAIL, password = process.env.DEMO_PASSWORD;
  return email && password ? { email, password } : null;
}

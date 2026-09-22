import nodemailer from "nodemailer";

/**
 * The morning email. Short on purpose: the call, the session, one addition.
 * Everything else lives on the page and in WHOOP.
 *
 * Email clients strip <style> blocks, so this is all inline styles.
 */
// Light, because that is how mail is read: a dark card in a white inbox
// looks like an advert, and the phone clients light it anyway. The state
// colours are the darker shades of the same hues, for contrast on white.
const BG = "#ffffff", CARD = "#fafafa", LINE = "#e4e4e7";
const FG = "#18181b", MUTED = "#52525b", DIM = "#71717a";
const STATE: Record<string, string> = {
  green: "#15803d", yellow: "#b45309", red: "#b91c1c",
};
const MONO = "'JetBrains Mono',Menlo,Consolas,monospace";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

type Session = {
  items: string[];
  blocks?: { title: string | null; note: string | null; items: string[] }[];
  /** Movements standing in for the usual ones today, so the change is not
   *  silent: an athlete should know why their session moved. */
  swaps?: { in: string; out: string; last: string | null }[];
  add: { name: string; dose: string; why: string } | null;
  hold: boolean;
};

export function renderEmail(opts: {
  date: string; dow: string; recovery: number;
  decision: { level: string; call: string; deload_advised?: boolean };
  session: Session; dashboardUrl: string;
  phase?: { phase: string; job: string; recovery_week: boolean };
  calendarUrl?: string;
}) {
  const { date, dow, recovery, decision: dec, session: ses, dashboardUrl } = opts;
  const c = STATE[dec.level];
  const badge = { green: "GO", yellow: "MODIFY", red: "HOLD" }[dec.level] ?? "";

  const row = (i: string) =>
    `<div style="font:400 14px ${MONO};color:${FG};padding:7px 0;border-bottom:1px solid ${LINE}">${i}</div>`;
  // Lifts come grouped: the compounds as straight sets, the small stuff as a
  // circuit. Each group gets a heading saying how to run it.
  const blocks = ses.blocks?.length ? ses.blocks : [{ title: null, note: null, items: ses.items }];
  const rows = blocks.map((b) =>
    (b.title
      ? `<div style="font:500 9px ${MONO};letter-spacing:.16em;text-transform:uppercase;color:${DIM};padding:14px 0 2px">${b.title}</div>` +
        (b.note ? `<div style="font:400 11px ${SANS};color:${MUTED};padding-bottom:4px">${b.note}</div>` : "")
      : "") + b.items.map(row).join("")).join("");

  const add = ses.add
    ? `<div style="border:1px solid #d3e59a;background:#f6fbe9;padding:12px 14px;margin-top:16px">
         <div style="font:500 9px ${MONO};letter-spacing:.16em;text-transform:uppercase;color:#4d7c0f">Add today</div>
         <div style="font:500 15px ${MONO};color:${FG};padding-top:6px">${ses.add.name} &middot; ${ses.add.dose}</div>
         <div style="font:400 12px ${SANS};color:${MUTED};padding-top:5px">${ses.add.why}</div>
       </div>`
    : "";

  const month = (d: string | null) => d
    ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    : null;
  const swaps = ses.swaps?.length
    ? `<div style="font:400 12px ${SANS};color:${MUTED};padding-top:10px;line-height:1.5">` +
      ses.swaps.map((s) => {
        const when = month(s.last);
        return `${s.in} in place of ${s.out}${when ? `, last done ${when}` : ""}.`;
      }).join(" ") +
      ` Same session, different movement.</div>`
    : "";

  const hold = ses.hold
    ? `<div style="font:400 12px ${SANS};color:${MUTED};padding-top:10px">Hold the weights where they were today.</div>`
    : "";

  const phase = opts.phase
    ? `<div style="border-top:1px solid ${LINE};margin-top:20px;padding-top:14px">
         <div style="font:500 9px ${MONO};letter-spacing:.16em;text-transform:uppercase;color:${DIM}">
           This block${opts.phase.recovery_week ? " &middot; recovery week" : ""}
         </div>
         <div style="font:500 14px ${SANS};color:${FG};padding-top:5px">${opts.phase.phase}</div>
         <div style="font:400 12px ${SANS};color:${MUTED};padding-top:4px;line-height:1.5">${opts.phase.job}</div>
       </div>`
    : "";

  const deload = dec.deload_advised
    ? `<div style="border:1px solid #f0d09a;background:#fdf8ef;padding:12px 14px;margin-top:16px">
         <div style="font:500 9px ${MONO};letter-spacing:.16em;text-transform:uppercase;color:#b45309">Recovery week advised</div>
         <div style="font:400 12px ${SANS};color:${MUTED};padding-top:5px;line-height:1.5">
           HRV has been under its band five mornings or more. Drop volume 20-30% for a
           week, keep intensity low, raise mobility work. This is not losing fitness.
         </div>
       </div>`
    : "";

  return `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<div style="background:${CARD};padding:24px 14px;font-family:${SANS}">
<div style="max-width:440px;margin:0 auto;background:${BG};border:1px solid ${LINE};border-radius:10px;padding:22px 20px">
  <div style="font:500 10px ${MONO};letter-spacing:.16em;text-transform:uppercase;color:${DIM};padding-bottom:14px">
    ${date} &middot; ${dow} &middot; <span style="color:${c}">${badge} &middot; ${Math.round(recovery)}%</span>
  </div>
  <div style="font:600 26px ${SANS};color:${FG};line-height:1.25;border-left:3px solid ${c};padding:2px 0 2px 14px">
    ${dec.call}
  </div>
  <div style="padding-top:20px">${rows}</div>
  ${swaps}
  ${hold}
  ${add}
  ${deload}
  ${phase}
  <div style="padding-top:22px">
    <a href="${dashboardUrl}" style="font:400 12px ${MONO};color:${DIM};text-decoration:none">Why &rarr;</a>
  </div>
</div></div>`;
}

/**
 * Sends the morning email. With SMTP_HOST set it goes over SMTP (a Gmail
 * account with an app password is enough to email anyone, up to Google's 500
 * a day); otherwise through Resend, whose test sender only delivers to the
 * Resend account's own address until EMAIL_FROM is on a verified domain.
 */
export async function sendEmail(to: string, subject: string, html: string) {
  return process.env.SMTP_HOST ? sendViaSmtp(to, subject, html) : sendViaResend(to, subject, html);
}

async function sendViaSmtp(to: string, subject: string, html: string) {
  const port = Number(process.env.SMTP_PORT ?? 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const info = await transport.sendMail({
    from: process.env.EMAIL_FROM ?? `Athlete OS <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
  return { id: info.messageId };
}

async function sendViaResend(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      // Resend sits behind Cloudflare, which rejects unrecognised agents.
      "User-Agent": "athlete-os/1.0",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "Athlete OS <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return (await res.json()) as { id: string };
}

/**
 * The morning email. Short on purpose: the call, the session, one addition.
 * Everything else lives on the page and in WHOOP.
 *
 * Email clients strip <style> blocks, so this is all inline styles.
 */
const BG = "#09090b", CARD = "#18181b", LINE = "#27272a";
const FG = "#fafafa", MUTED = "#a1a1aa", DIM = "#71717a";
const STATE: Record<string, string> = {
  green: "#22c55e", yellow: "#f59e0b", red: "#ef4444",
};
const MONO = "'JetBrains Mono',Menlo,Consolas,monospace";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

type Session = {
  items: string[];
  add: { name: string; dose: string; why: string } | null;
  hold: boolean;
};

export function renderEmail(opts: {
  date: string; dow: string; recovery: number;
  decision: { level: string; call: string };
  session: Session; dashboardUrl: string;
}) {
  const { date, dow, recovery, decision: dec, session: ses, dashboardUrl } = opts;
  const c = STATE[dec.level];
  const badge = { green: "GO", yellow: "MODIFY", red: "HOLD" }[dec.level] ?? "";

  const rows = ses.items
    .map((i) => `<div style="font:400 14px ${MONO};color:${FG};padding:7px 0;border-bottom:1px solid ${LINE}">${i}</div>`)
    .join("");

  const add = ses.add
    ? `<div style="border:1px solid #3f4d1f;background:#141a0c;padding:12px 14px;margin-top:16px">
         <div style="font:500 9px ${MONO};letter-spacing:.16em;text-transform:uppercase;color:#a3e635">Add today</div>
         <div style="font:500 15px ${MONO};color:${FG};padding-top:6px">${ses.add.name} &middot; ${ses.add.dose}</div>
         <div style="font:400 12px ${SANS};color:${MUTED};padding-top:5px">${ses.add.why}</div>
       </div>`
    : "";

  const hold = ses.hold
    ? `<div style="font:400 12px ${SANS};color:${MUTED};padding-top:10px">Hold the weights where they were today.</div>`
    : "";

  return `<div style="background:${BG};padding:24px 14px;font-family:${SANS}">
<div style="max-width:440px;margin:0 auto">
  <div style="font:500 10px ${MONO};letter-spacing:.16em;text-transform:uppercase;color:${DIM};padding-bottom:14px">
    ${date} &middot; ${dow} &middot; <span style="color:${c}">${badge} &middot; ${Math.round(recovery)}%</span>
  </div>
  <div style="font:600 26px ${SANS};color:${FG};line-height:1.25;border-left:3px solid ${c};padding:2px 0 2px 14px">
    ${dec.call}
  </div>
  <div style="padding-top:20px">${rows}</div>
  ${hold}
  ${add}
  <div style="padding-top:22px">
    <a href="${dashboardUrl}" style="font:400 12px ${MONO};color:${DIM};text-decoration:none">Why &rarr;</a>
  </div>
</div></div>`;
}

export async function sendEmail(subject: string, html: string) {
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
      to: [process.env.EMAIL_TO],
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return (await res.json()) as { id: string };
}

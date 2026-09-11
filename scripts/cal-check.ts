import { buildCalendar } from "../lib/athlete/calendar";
const { weeks, unlocked } = buildCalendar({
  raceDate: "2027-03-21", today: "2026-09-11", recentLongMi: 3,
  longestEver: 4.54, lacrosseDays: ["Tue", "Wed"], z2: 148, consistencyWeeks: 1,
});
console.log("weeks:", weeks.length, "| gates:", JSON.stringify(unlocked));
for (const w of weeks.filter((x, i) => i % 4 === 0 || x.recovery_week).slice(0, 14))
  console.log(`  ${w.start}  ${w.phase.padEnd(20)} wk${w.week_in_block}` +
    `${w.recovery_week ? " [RECOVERY]" : "          "}  long ${String(w.long_run_mi).padStart(5)}mi  easy ${w.easy_run_min}min`);
const last = weeks[weeks.length - 1];
console.log("race week:", last.start, "|", last.phase, "| long", last.long_run_mi);
console.log("week 0 days:", weeks[0].days.map(d => `${d.dow}:${d.kind}`).join("  "));

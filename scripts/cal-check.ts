import { buildCalendar } from "../lib/athlete/calendar";
import { racePlan } from "../lib/athlete/decide";

function show(label: string, achieved: number, consistency: number) {
  const p = racePlan("2027-03-21", "2026-09-11", achieved, 4.54);
  console.log(`\n=== ${label}: achieved ${achieved}mi, ${consistency} consistent weeks ===`);
  console.log(`  anchored ${p.anchored_on_mi}mi | growth ${p.growth_per_week}%/wk ` +
    `(needed ${p.needed_growth_per_week}%) | on track: ${p.on_track} | reachable peak ${p.reachable_peak_mi}mi`);
  const { weeks } = buildCalendar({
    raceDate: "2027-03-21", today: "2026-09-11", recentLongMi: achieved,
    longestEver: 4.54, lacrosseDays: ["Tue","Wed"], z2: 148, consistencyWeeks: consistency,
  });
  for (const w of weeks.filter((x, i) => i % 6 === 0))
    console.log(`  ${w.start}  ${w.phase.padEnd(24)} long ${String(w.long_run_mi).padStart(5)}mi  easy ${w.easy_run_min}min${w.recovery_week ? "  [rec]" : ""}`);
}
show("On plan", 3.0, 1);
show("Behind — missed a month", 2.5, 0);
show("Ahead", 6.0, 12);

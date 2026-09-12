import { buildCalendar } from "../lib/athlete/calendar";
import { planInputs, racePlan } from "../lib/athlete/decide";

// A half marathon on 2027-03-21 around lacrosse on Tuesdays and Wednesdays:
// how the long-run ladder responds to being on plan, behind, and ahead.
const inputs = planInputs({
  goals: { primary: "race", race: { distance: "half", date: "2027-03-21" } },
  week: { lift_days: 3, run_days: 2, long_run_day: "Sat" },
  activities: [{ sport: "lacrosse", label: "Lacrosse", days: ["Tue", "Wed"], intensity: "hard" }],
  athlete: { zone2_ceiling_bpm: 148, longest_run_mi: 4.54 },
});

function show(label: string, achieved: number, consistency: number) {
  const p = racePlan(inputs.race, "2026-09-11", achieved, inputs.longestRunMi);
  console.log(`\n=== ${label}: achieved ${achieved}mi, ${consistency} consistent weeks ===`);
  console.log(`  anchored ${p.anchored_on_mi}mi | growth ${p.growth_per_week}%/wk ` +
    `(needed ${p.needed_growth_per_week}%) | on track: ${p.on_track} | reachable peak ${p.reachable_peak_mi}mi`);
  const { weeks } = buildCalendar({
    inputs, today: "2026-09-11", recentLongMi: achieved, consistencyWeeks: consistency,
  });
  for (const w of weeks.filter((x, i) => i % 6 === 0))
    console.log(`  ${w.start}  ${w.phase.padEnd(24)} long ${String(w.long_run_mi).padStart(5)}mi  easy ${w.easy_run_min}min${w.recovery_week ? "  [rec]" : ""}`);
}
show("On plan", 3.0, 1);
show("Behind — missed a month", 2.5, 0);
show("Ahead", 6.0, 12);

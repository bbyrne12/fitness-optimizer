import { parseLog } from "../lib/athlete/parse-log";
const cases: [string, string][] = [
  ["no date (uses today)", "Leg press: 320 x 12"],
  ["9/10:",                "9/10:\nLeg press: 320 x 12"],
  ["9/10/26:",             "9/10/26:\nLeg press: 320 x 12"],
  ["9-10",                 "9-10\nLeg press: 320 x 12"],
  ["Sept 10",              "Sept 10\nLeg press: 320 x 12"],
  ["September 10th",       "September 10th\nLeg press: 320 x 12"],
  ["real session",         "9/10:\nLeg press: 320 x 12\nX4:\nInner thigh: 130 x 10\n\nCalf raises: 60 x 25"],
];
for (const [label, text] of cases) {
  const r = parseLog(text, 2026, "2026-09-11");
  console.log(`  ${label.padEnd(22)} -> ${r.sets.length} sets  ${r.sets[0]?.day ?? ""}${r.dated ? "" : "  (assumed today)"}`);
}

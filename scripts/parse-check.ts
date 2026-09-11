import { readFileSync } from "fs";
import { parseLog } from "../lib/athlete/parse-log";
const DIR = "C:/Users/bradl/OneDrive/Documents/Projects/whoop-dashboard";
let all: any[] = [];
for (const y of [2024, 2025, 2026]) {
  const r = parseLog(readFileSync(`${DIR}/workout-log-${y}.txt`, "utf8"));
  console.log(`  ${y}: ${r.sets.length} sets, ${r.days} days, ${r.unparsed.length} unparsed`);
  all = all.concat(r.sets);
}
const py = JSON.parse(readFileSync(`${DIR}/workout_sets.json`, "utf8"));
console.log(`\nTS total ${all.length}  |  Python total ${py.length}`);
const key = (r: any): string => `${r.day ?? r.date}|${r.exercise.trim().toLowerCase()}|${r.weight}|${r.reps}|${r.sets}`;
const ts = new Set(all.map(key)), pys = new Set(py.map(key));
const onlyTs = [...ts].filter((k) => !pys.has(k as string));
const onlyPy = [...pys].filter((k) => !ts.has(k as string));
console.log(`only in TS: ${onlyTs.length}   only in Python: ${onlyPy.length}`);
onlyTs.slice(0, 5).forEach(k => console.log("   TS+", k));
onlyPy.slice(0, 5).forEach(k => console.log("   PY+", k));

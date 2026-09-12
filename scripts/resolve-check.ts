import { canonical, musclesFor } from "../lib/athlete/muscles";
import { norm } from "../lib/athlete/resolve-exercises";
import { readFileSync } from "fs";
import { parseLog } from "../lib/athlete/parse-log";
const DIR = "C:/Users/bradl/OneDrive/Documents/Projects/whoop-dashboard";
let names = new Set<string>();
for (const y of [2024, 2025, 2026])
  for (const s of parseLog(readFileSync(`${DIR}/workout-log-${y}.txt`, "utf8")).sets)
    names.add(s.exercise);
let vocab = 0; const unknown: string[] = [];
for (const n of names) (canonical(norm(n)) ? vocab++ : unknown.push(n));
console.log(`  ${names.size} distinct names typed over 3 years`);
console.log(`  ${vocab} resolved free by your own vocabulary map`);
console.log(`  ${unknown.length} would go to library-then-Claude: ${unknown.slice(0,10).join(", ")}`);

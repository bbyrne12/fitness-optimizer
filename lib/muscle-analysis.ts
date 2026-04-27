/**
 * Muscle routine analysis engine.
 *
 * This module is intentionally "pure": it contains no DB calls and no framework
 * dependencies. Pass routine data in, get an analysis object back.
 */

export type MuscleGroup =
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "forearms"
  | "quadriceps"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "abdominals"
  | "abductors"
  | "adductors"
  | "lats"
  | "middle back"
  | "lower back"
  | "traps"
  | "neck";

export type RoutineExercise = {
  exercise_id: number;
  name: string;
  primary_muscle: MuscleGroup | string;
  secondary_muscles: string[];
  sets: number;
  reps: number;
  weight: number;
  day_of_week: number; // 1=Monday ... 7=Sunday
};

export type Severity = "low" | "medium" | "high";

/**
 * Maps specific muscle names to broader "buckets" used for volume tracking.
 * For example, "lats" / "middle back" / "lower back" / "traps" all roll up
 * into "back" so the analyzer can detect "back not trained" correctly.
 */
export function getMuscleGroupBucket(muscle: string): string {
  const m = (muscle || "").toLowerCase().trim();

  if (m === "lats") return "back";
  if (m === "middle back") return "back";
  if (m === "lower back") return "back";
  if (m === "traps") return "back";

  if (m === "front delts") return "shoulders";
  if (m === "side delts") return "shoulders";
  if (m === "rear delts") return "shoulders";

  if (m === "abductors") return "glutes";
  if (m === "adductors") return "glutes";

  if (m === "obliques") return "abdominals";

  if (m === "forearms") return "biceps";

  return m;
}

export type Imbalance = {
  severity: Severity;
  title: string;
  description: string;
};

export type MuscleAnalysis = {
  weeklyVolume: Record<string, number>; // "sets per week" per muscle
  totalSets: number;
  daysPerWeek: number;
  imbalances: Imbalance[];
  recommendations: string[];
  pushPullRatio: { push: number; pull: number; ratio: number };
  upperLowerRatio: { upper: number; lower: number; ratio: number };
};

/**
 * Display helper for "how much is this?"
 * (Set thresholds are intentionally simple and easy to reason about.)
 */
export function getVolumeLevel(
  sets: number,
): "none" | "low" | "moderate" | "high" | "very_high" {
  if (sets <= 0) return "none";
  if (sets <= 5) return "low";
  if (sets <= 12) return "moderate";
  if (sets <= 20) return "high";
  return "very_high";
}

/**
 * Buckets a muscle string into a broad category used by UI.
 * Unknown/novel muscle names fall into "other".
 */
export function getMuscleGroupCategory(
  muscle: string,
): "push" | "pull" | "legs" | "core" | "other" {
  const m = normalizeMuscleName(muscle);

  if (PUSH_MUSCLES.has(m)) return "push";
  if (PULL_MUSCLES.has(m)) return "pull";
  if (LEGS_MUSCLES.has(m)) return "legs";
  if (CORE_MUSCLES.has(m)) return "core";

  return "other";
}

/**
 * Main entry point.
 *
 * The analysis is based on weekly "hard sets" per muscle:
 * - Primary muscle gets full sets
 * - Secondary muscles get half sets (0.5x), representing partial involvement
 */
export function analyzeRoutine(routine: RoutineExercise[]): MuscleAnalysis {
  const weeklyVolume: Record<string, number> = {};
  const days = new Set<number>();

  let totalSets = 0;

  for (const ex of routine) {
    const sets = safeNumber(ex.sets);
    if (sets <= 0) continue;

    totalSets += sets;
    if (Number.isFinite(ex.day_of_week)) days.add(ex.day_of_week);

    // Primary muscle: full sets
    const primary = normalizeMuscleName(ex.primary_muscle);
    addVolume(weeklyVolume, primary, sets);

    // Secondary muscles: half sets
    for (const secRaw of ex.secondary_muscles ?? []) {
      const sec = normalizeMuscleName(secRaw);
      if (!sec) continue;
      addVolume(weeklyVolume, sec, 0.5 * sets);
    }
  }

  const daysPerWeek = days.size;

  // --- Ratios ---
  const push = sumVolumeFor(weeklyVolume, PUSH_MUSCLES);
  const pull = sumVolumeFor(weeklyVolume, PULL_MUSCLES);
  const upper = sumVolumeFor(weeklyVolume, UPPER_MUSCLES);
  const lower = sumVolumeFor(weeklyVolume, LOWER_MUSCLES);

  const pushPullRatio = {
    push,
    pull,
    ratio: safeRatio(push, pull),
  };

  const upperLowerRatio = {
    upper,
    lower,
    ratio: safeRatio(upper, lower),
  };

  // --- Imbalances + recommendations ---
  const imbalances: Imbalance[] = [];
  const recommendations: string[] = [];

  // Major muscle groups we want to explicitly "cover" in a general routine.
  const majorMuscles: MuscleGroup[] = [
    "chest",
    "back",
    "shoulders",
    "biceps",
    "triceps",
    "quadriceps",
    "hamstrings",
    "glutes",
    "calves",
    "abdominals",
  ];

  const majorVolumes = majorMuscles.map((m) => ({
    muscle: m,
    sets: weeklyVolume[m] ?? 0,
  }));

  // High: extreme push/pull imbalance
  if (pushPullRatio.ratio > 2 || pushPullRatio.ratio < 0.5) {
    const direction =
      pushPullRatio.ratio > 2
        ? "You have much more pushing than pulling."
        : "You have much more pulling than pushing.";
    imbalances.push({
      severity: "high",
      title: "Push/pull imbalance",
      description: `${direction} Add volume to the weaker side (rows/pull-downs for pull, presses for push) until the ratio is closer to 1.`,
    });
  }

  // High: a major muscle group has 0 sets while others have 6+
  const anyMajorHas6Plus = majorVolumes.some((x) => x.sets >= 6);
  if (anyMajorHas6Plus) {
    for (const { muscle, sets } of majorVolumes) {
      if (sets === 0) {
        imbalances.push({
          severity: "high",
          title: `${titleCase(muscle)} not trained`,
          description: `You have 0 hard sets for ${muscle}. Add at least 6 sets/week across 1–2 exercises to keep your routine balanced and reduce weak links.`,
        });
      }
    }
  }

  // Medium: upper/lower imbalance
  if (upperLowerRatio.ratio > 3 || upperLowerRatio.ratio < 0.33) {
    const direction =
      upperLowerRatio.ratio > 3
        ? "Upper body volume dominates lower body volume."
        : "Lower body volume dominates upper body volume.";
    imbalances.push({
      severity: "medium",
      title: "Upper/lower imbalance",
      description: `${direction} Add 6–10 sets/week to the under-trained half (e.g., squats/hinges for lower; rows/presses for upper).`,
    });
  }

  // Medium: any major muscle group < 6 sets
  for (const { muscle, sets } of majorVolumes) {
    if (sets > 0 && sets < 6) {
      imbalances.push({
        severity: "medium",
        title: `Low ${muscle} volume`,
        description: `You only have about ${round1(sets)} sets/week for ${muscle}. Aim for at least 6–10 weekly sets by adding 2–4 sets across 1–2 days.`,
      });
    }
  }

  // Low: overall volume per major muscle is < 10 sets (general "not enough stimulus")
  // This is intentionally a gentle nudge; it's common for early routines to be light.
  const lowOverall = majorVolumes.filter((x) => x.sets > 0 && x.sets < 10);
  if (lowOverall.length >= 3) {
    imbalances.push({
      severity: "low",
      title: "Low overall volume",
      description:
        "Several major muscle groups are under 10 sets/week. If recovery allows, add 2 sets to 2–3 muscles this week to improve overall progress.",
    });
  }

  // Recommendations: derive 3–5 short suggestions from the analysis.
  //
  // Goal: keep them small, actionable, and easy to apply next week.
  addRecommendationsFromRatios(recommendations, pushPullRatio, upperLowerRatio);
  addRecommendationsFromMajorMuscles(recommendations, majorVolumes);
  addGeneralRecommendations(recommendations, daysPerWeek, totalSets);

  return {
    weeklyVolume: sortVolumeRecord(weeklyVolume),
    totalSets: round1(totalSets),
    daysPerWeek,
    imbalances: dedupeImbalances(imbalances),
    recommendations: capUnique(recommendations, 5),
    pushPullRatio: {
      push: round1(pushPullRatio.push),
      pull: round1(pushPullRatio.pull),
      ratio: round2(pushPullRatio.ratio),
    },
    upperLowerRatio: {
      upper: round1(upperLowerRatio.upper),
      lower: round1(upperLowerRatio.lower),
      ratio: round2(upperLowerRatio.ratio),
    },
  };
}

// -----------------------------
// Internal helpers / constants
// -----------------------------

const PUSH_MUSCLES = new Set<string>(["chest", "shoulders", "triceps"]);
const PULL_MUSCLES = new Set<string>([
  "back",
  "lats",
  "middle back",
  "lower back",
  "biceps",
  "traps",
]);
const LEGS_MUSCLES = new Set<string>([
  "quadriceps",
  "hamstrings",
  "glutes",
  "calves",
  "abductors",
  "adductors",
]);
const CORE_MUSCLES = new Set<string>(["abdominals"]);

const UPPER_MUSCLES = new Set<string>([
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "lats",
  "middle back",
  "traps",
]);
const LOWER_MUSCLES = new Set<string>([
  "quadriceps",
  "hamstrings",
  "glutes",
  "calves",
  "abductors",
  "adductors",
]);

function normalizeMuscleName(input: unknown): string {
  if (typeof input !== "string") return "";
  // Keep canonical strings like "middle back" intact; normalize spacing/case.
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

function safeNumber(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : 0;
}

function addVolume(record: Record<string, number>, muscle: string, sets: number) {
  const m = normalizeMuscleName(muscle);
  if (!m) return;
  const bucket = getMuscleGroupBucket(m);
  record[bucket] = (record[bucket] ?? 0) + safeNumber(sets);
}

function sumVolumeFor(record: Record<string, number>, muscles: Set<string>) {
  let sum = 0;
  for (const m of muscles) sum += record[m] ?? 0;
  return sum;
}

function safeRatio(a: number, b: number) {
  if (b <= 0) return a > 0 ? Infinity : 0;
  return a / b;
}

function titleCase(s: string) {
  return s
    .split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function sortVolumeRecord(record: Record<string, number>) {
  const entries = Object.entries(record).sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries);
}

function dedupeImbalances(items: Imbalance[]) {
  const seen = new Set<string>();
  const order: Severity[] = ["high", "medium", "low"];
  return items
    .slice()
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
    .filter((x) => {
      const key = `${x.severity}|${x.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function capUnique(list: string[], max: number) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= max) break;
  }
  return out;
}

function addRecommendationsFromRatios(
  recs: string[],
  pushPull: { push: number; pull: number; ratio: number },
  upperLower: { upper: number; lower: number; ratio: number },
) {
  if (pushPull.ratio === Infinity) {
    recs.push("Add 6–10 sets of pulling work this week (rows, pulldowns, face pulls).");
  } else if (pushPull.ratio > 2) {
    recs.push("Add 2–4 sets of pulling work on 2 days this week to balance pressing.");
  } else if (pushPull.ratio < 0.5) {
    recs.push("Add 2–4 sets of pressing work (bench/overhead press) this week.");
  }

  if (upperLower.ratio === Infinity) {
    recs.push("Add a lower-body day (squat + hinge) to build a balanced base.");
  } else if (upperLower.ratio > 3) {
    recs.push("Include posterior chain exercises like RDLs/hip hinges and a squat pattern this week.");
  } else if (upperLower.ratio < 0.33) {
    recs.push("Add upper-body pulling and pressing (rows + presses) to balance leg volume.");
  }
}

function addRecommendationsFromMajorMuscles(
  recs: string[],
  majorVolumes: Array<{ muscle: MuscleGroup; sets: number }>,
) {
  const missing = majorVolumes.filter((x) => x.sets === 0);
  if (missing.length > 0) {
    const m = missing[0].muscle;
    recs.push(`Add at least 6 sets/week for ${m} (1–2 exercises across 1–2 days).`);
  }

  const low = majorVolumes
    .filter((x) => x.sets > 0 && x.sets < 6)
    .sort((a, b) => a.sets - b.sets);

  if (low.length > 0) {
    const m = low[0].muscle;
    recs.push(`Increase ${m} volume by ~2 sets this week (small, easy win).`);
  }
}

function addGeneralRecommendations(recs: string[], daysPerWeek: number, totalSets: number) {
  if (daysPerWeek <= 2 && totalSets > 0) {
    recs.push("If recovery allows, spread volume across 3–4 days for better quality sets.");
  }
  if (totalSets > 0 && totalSets < 30) {
    recs.push("Consider adding 1–2 sets to 2 exercises this week to gradually increase total volume.");
  }
  if (totalSets === 0) {
    recs.push("Start with a simple full-body routine 3 days/week and track your sets consistently.");
  }
}

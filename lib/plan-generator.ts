/**
 * Weekly workout plan generator.
 *
 * Pure module: no Supabase, no React, no network calls.
 * Takes user inputs and exercise candidates, returns a weekly plan.
 */

export type ExerciseCandidate = {
  id: number;
  name: string;
  primary_muscle: string;
  secondary_muscles: string[];
  equipment: string | null;
  difficulty: string;
};

type ExperienceLevel =
  | "Beginner (less than 6 months)"
  | "Intermediate (6 months to 2 years)"
  | "Advanced (2+ years)";

type EquipmentTag =
  | "Full gym access"
  | "Dumbbells"
  | "Barbell and plates"
  | "Resistance bands"
  | "Bodyweight only";

type PlanInput = {
  availableDays: number[];
  experience: ExperienceLevel | string;
  availableEquipment: EquipmentTag[] | string[];
  exerciseLibrary: ExerciseCandidate[];
  weeklyVolume: Record<string, number>;
  imbalanceMuscles: string[];
};

type PlannedExercise = {
  exercise_id: number;
  name: string;
  primary_muscle: string;
  sets: number;
  reps: number;
  rationale: string;
};

type PlannedDay = {
  day_of_week: number;
  focus: string;
  exercises: PlannedExercise[];
  totalSets: number;
};

export type WeeklyPlan = {
  days: PlannedDay[];
  notes: string[];
};

const PUSH_MUSCLES = [
  "chest",
  "shoulders",
  "triceps",
  "front delts",
  "side delts",
];

const PULL_MUSCLES = [
  "back",
  "lats",
  "middle back",
  "lower back",
  "biceps",
  "traps",
  "rear delts",
];

const LEG_MUSCLES = [
  "quadriceps",
  "hamstrings",
  "glutes",
  "calves",
  "abductors",
  "adductors",
];

const DAY_NAMES: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

function getSplitForDays(numDays: number): string[] {
  if (numDays <= 0) return [];
  if (numDays === 1) return ["Full Body"];
  if (numDays === 2) return ["Full Body", "Full Body"];
  if (numDays === 3) return ["Push", "Pull", "Legs"];
  if (numDays === 4) return ["Upper", "Lower", "Upper", "Lower"];
  if (numDays === 5) return ["Push", "Pull", "Legs", "Upper", "Lower"];
  return ["Push", "Pull", "Legs", "Push", "Pull", "Legs"].slice(0, numDays);
}

function getMusclesForFocus(focus: string): string[] {
  switch (focus) {
    case "Push":
      return PUSH_MUSCLES;
    case "Pull":
      return PULL_MUSCLES;
    case "Legs":
      return LEG_MUSCLES;
    case "Upper":
      return [...PUSH_MUSCLES, ...PULL_MUSCLES];
    case "Lower":
      return LEG_MUSCLES;
    case "Full Body":
      return [...PUSH_MUSCLES, ...PULL_MUSCLES, ...LEG_MUSCLES];
    default:
      return [];
  }
}

function isAccessible(
  exercise: ExerciseCandidate,
  equipmentTags: string[],
): boolean {
  if (equipmentTags.includes("Full gym access")) return true;

  const allowed = new Set<string>();
  for (const tag of equipmentTags) {
    if (tag === "Dumbbells") {
      allowed.add("dumbbell");
      allowed.add("body only");
      allowed.add("kettlebells");
    } else if (tag === "Barbell and plates") {
      allowed.add("barbell");
      allowed.add("body only");
    } else if (tag === "Resistance bands") {
      allowed.add("bands");
      allowed.add("body only");
    } else if (tag === "Bodyweight only") {
      allowed.add("body only");
    }
  }

  if (allowed.size === 0) return true;
  return exercise.equipment ? allowed.has(exercise.equipment) : false;
}

function pickExercisesForFocus(
  focus: string,
  candidates: ExerciseCandidate[],
  count: number,
  prioritizeMuscles: string[],
  equipmentTags: string[],
  alreadyUsed: Set<number>,
): ExerciseCandidate[] {
  const muscles = getMusclesForFocus(focus);
  if (muscles.length === 0) return [];

  const eligible = candidates.filter((ex) => {
    if (alreadyUsed.has(ex.id)) return false;
    if (!isAccessible(ex, equipmentTags)) return false;
    const muscleLc = (ex.primary_muscle || "").toLowerCase();
    return muscles.some((m) => muscleLc.includes(m));
  });

  const priorityLc = prioritizeMuscles.map((m) => m.toLowerCase());
  const scored = eligible
    .map((ex) => {
      const muscleLc = (ex.primary_muscle || "").toLowerCase();
      const isPriority = priorityLc.some((p) => muscleLc.includes(p));
      return { ex, score: isPriority ? 1 : 0 };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.ex.name.localeCompare(b.ex.name);
    });

  return scored.slice(0, count).map((s) => s.ex);
}

function getVolumeForExperience(experience: string): {
  exercisesPerDay: number;
  setsPerExercise: number;
  reps: number;
} {
  const lower = experience.toLowerCase();
  if (lower.includes("beginner")) {
    return { exercisesPerDay: 3, setsPerExercise: 3, reps: 10 };
  }
  if (lower.includes("advanced")) {
    return { exercisesPerDay: 5, setsPerExercise: 3, reps: 8 };
  }
  return { exercisesPerDay: 4, setsPerExercise: 3, reps: 10 };
}

function buildRationale(
  exercise: ExerciseCandidate,
  focus: string,
  imbalanceMuscles: string[],
): string {
  const muscleLc = (exercise.primary_muscle || "").toLowerCase();
  const isImbalance = imbalanceMuscles.some((m) =>
    muscleLc.includes(m.toLowerCase()),
  );

  if (isImbalance) {
    return "Targets " + exercise.primary_muscle + " to address imbalance";
  }

  if (exercise.secondary_muscles && exercise.secondary_muscles.length >= 2) {
    return "Compound movement for overall " + focus + " development";
  }

  return "Builds " + focus.toLowerCase() + " strength";
}

export function generateWeeklyPlan(input: PlanInput): WeeklyPlan {
  const {
    availableDays,
    experience,
    availableEquipment,
    exerciseLibrary,
    imbalanceMuscles,
  } = input;

  const sortedDays = [...availableDays].sort((a, b) => a - b);
  const numDays = sortedDays.length;
  const split = getSplitForDays(numDays);

  const days: PlannedDay[] = [];
  for (let d = 1; d <= 7; d += 1) {
    days.push({
      day_of_week: d,
      focus: "Rest",
      exercises: [],
      totalSets: 0,
    });
  }

  const notes: string[] = [];

  if (numDays === 0) {
    notes.push("Set your available days first to generate a plan.");
    return { days, notes };
  }

  const equipmentTags = availableEquipment.map((e) => String(e));
  const { exercisesPerDay, setsPerExercise, reps } = getVolumeForExperience(
    String(experience),
  );

  const usedAcrossWeek = new Set<number>();

  for (let i = 0; i < numDays; i += 1) {
    const dayNumber = sortedDays[i];
    const focus = split[i] || "Full Body";

    const usedThisDay = new Set<number>();
    const exercisesPicked = pickExercisesForFocus(
      focus,
      exerciseLibrary,
      exercisesPerDay,
      imbalanceMuscles,
      equipmentTags,
      numDays >= 6 ? usedThisDay : usedAcrossWeek,
    );

    const planned: PlannedExercise[] = exercisesPicked.map((ex) => {
      usedAcrossWeek.add(ex.id);
      return {
        exercise_id: ex.id,
        name: ex.name,
        primary_muscle: ex.primary_muscle,
        sets: setsPerExercise,
        reps,
        rationale: buildRationale(ex, focus, imbalanceMuscles),
      };
    });

    const dayIdx = days.findIndex((d) => d.day_of_week === dayNumber);
    if (dayIdx >= 0) {
      days[dayIdx] = {
        day_of_week: dayNumber,
        focus,
        exercises: planned,
        totalSets: planned.reduce((sum, ex) => sum + ex.sets, 0),
      };
    }
  }

  if (imbalanceMuscles.length > 0) {
    const top = imbalanceMuscles.slice(0, 3).join(", ");
    notes.push(
      "This plan adds volume to " + top + " to address imbalances.",
    );
  }

  const restDays = days
    .filter((d) => d.focus === "Rest")
    .map((d) => DAY_NAMES[d.day_of_week]);
  if (restDays.length > 0 && restDays.length < 7) {
    notes.push(
      "Rest days are scheduled on " + restDays.join(", ") + " for recovery.",
    );
  }

  if (numDays === 1) {
    notes.push("Add more training days for better results.");
  } else if (numDays >= 7) {
    notes.push("Consider taking at least one rest day per week.");
  }

  notes.push("Adjust weights to match the rep ranges shown.");

  return { days, notes };
}

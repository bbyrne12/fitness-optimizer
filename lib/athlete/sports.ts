/**
 * Activities offered in the setup form, by the sport_name WHOOP records them
 * under, so a chosen sport lines up with the athlete's own WHOOP history and
 * its recovery cost can be measured. Running and lifting are not offered here:
 * those are the run and lift days.
 */
export const COMMON_SPORTS = [
  "soccer", "basketball", "lacrosse", "tennis", "pickleball", "volleyball",
  "ice-hockey", "field-hockey", "football", "baseball", "softball", "rugby",
  "squash", "golf", "cycling", "spin", "swimming", "rowing", "hiking-rucking",
  "rock-climbing", "yoga", "pilates", "boxing", "martial-arts", "skiing",
  "snowboarding", "surfing", "dance", "hiit", "functional-fitness",
];

/** Recorded by WHOOP, but covered by run and lift days or too light to plan around. */
export const EXCLUDED_SPORTS = new Set([
  "running", "weightlifting", "weightlifting_msk", "powerlifting",
  "activity", "walking", "meditation", "stretching",
]);

const LABELS: Record<string, string> = {
  "hiking-rucking": "Hiking / rucking",
  hiit: "HIIT",
  "ice-hockey": "Ice hockey",
  "field-hockey": "Field hockey",
  "rock-climbing": "Rock climbing",
  "martial-arts": "Martial arts",
  "functional-fitness": "Functional fitness",
};

export function sportLabel(sport: string) {
  return LABELS[sport] ?? sport.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** "Ultimate Frisbee" -> "ultimate-frisbee": the shape sport names are stored in. */
export function slugify(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

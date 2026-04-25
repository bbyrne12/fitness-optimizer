import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

// Load .env.local
config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const EXERCISES_URL =
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";

type RawExercise = {
  id: string;
  name: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string | null;
  level: string;
  force?: string;
  mechanic?: string;
  category?: string;
  instructions?: string[];
};

async function main() {
  console.log("Fetching exercises from GitHub...");
  const response = await fetch(EXERCISES_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`);
  }
  const exercises: RawExercise[] = await response.json();
  console.log(`Fetched ${exercises.length} exercises`);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Check if exercises already exist (prevent duplicate seeds)
  const { count, error: countError } = await supabase
    .from("exercises")
    .select("*", { count: "exact", head: true });

  if (countError) {
    console.error("Error checking existing exercises:", countError);
    process.exit(1);
  }

  if (count && count > 0) {
    console.log(`Exercises table already has ${count} rows. Skipping seed.`);
    console.log("To re-seed, delete existing rows first in Supabase dashboard.");
    process.exit(0);
  }

  // Transform to match our schema
  const rows = exercises.map((e) => ({
    name: e.name,
    primary_muscle: e.primaryMuscles?.[0] ?? null,
    secondary_muscles: e.secondaryMuscles ?? [],
    equipment: e.equipment,
    difficulty: e.level,
  }));

  // Insert in batches of 500 (Supabase has payload size limits)
  const BATCH_SIZE = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("exercises").insert(batch);
    if (error) {
      console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, error);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`Inserted ${inserted} / ${rows.length}`);
  }

  console.log(`✓ Seeded ${inserted} exercises`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
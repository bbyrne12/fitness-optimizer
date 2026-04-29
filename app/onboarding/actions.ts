"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type OnboardingPayload = {
  primaryGoal: string;
  experienceLevel: string;
  availableEquipment: string[];
};

export async function saveOnboardingProfile(payload: OnboardingPayload) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) return { error: userError.message };
  if (!user) return { error: "You must be signed in to continue." };

  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    primary_goal: payload.primaryGoal,
    experience_level: payload.experienceLevel,
    available_equipment: payload.availableEquipment,
  });

  if (error) return { error: error.message };

  // Ensure the user has a default plan to populate their dashboard
  const { data: existingPlan } = await supabase
    .from("plans")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existingPlan) {
    await supabase.from("plans").insert({
      user_id: user.id,
      name: "My Routine",
      source: "manual",
      is_active: true,
    });
  }

  redirect("/protected");
}


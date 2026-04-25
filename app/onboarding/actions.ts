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

  redirect("/protected");
}


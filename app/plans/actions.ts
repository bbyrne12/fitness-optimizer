"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

type ActionResult = { error?: string };

async function getAuthedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) return { supabase, user: null, error: error.message };
  if (!user) return { supabase, user: null, error: "Not authenticated" };
  return { supabase, user, error: null as string | null };
}

async function userOwnsPlan(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  planId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase
      .from("plans")
      .select("id")
      .eq("id", planId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Plan not found" };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function setActivePlan(planId: string): Promise<ActionResult> {
  if (!planId) return { error: "Missing plan id" };

  try {
    const { supabase, user, error: authError } = await getAuthedUser();
    if (authError || !user) return { error: authError ?? "Not authenticated" };

    const owns = await userOwnsPlan(supabase, user.id, planId);
    if (!owns.ok) return { error: owns.error ?? "Plan not found" };

    const { error: clearError } = await supabase
      .from("plans")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("is_active", true);
    if (clearError) return { error: clearError.message };

    const { error: setError } = await supabase
      .from("plans")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq("id", planId)
      .eq("user_id", user.id);
    if (setError) return { error: setError.message };

    revalidatePath("/plans");
    revalidatePath("/protected");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to set active plan" };
  }
}

export async function deletePlan(planId: string): Promise<ActionResult> {
  if (!planId) return { error: "Missing plan id" };

  try {
    const { supabase, user, error: authError } = await getAuthedUser();
    if (authError || !user) return { error: authError ?? "Not authenticated" };

    const { data: target, error: fetchError } = await supabase
      .from("plans")
      .select("id, is_active")
      .eq("id", planId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (fetchError) return { error: fetchError.message };
    if (!target) return { error: "Plan not found" };

    if (target.is_active) {
      const { data: replacement, error: repError } = await supabase
        .from("plans")
        .select("id")
        .eq("user_id", user.id)
        .neq("id", planId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (repError) return { error: repError.message };

      const { error: clearError } = await supabase
        .from("plans")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", planId)
        .eq("user_id", user.id);
      if (clearError) return { error: clearError.message };

      if (replacement?.id) {
        const { error: promoteError } = await supabase
          .from("plans")
          .update({ is_active: true, updated_at: new Date().toISOString() })
          .eq("id", replacement.id)
          .eq("user_id", user.id);
        if (promoteError) return { error: promoteError.message };
      }
    }

    const { error: deleteError } = await supabase
      .from("plans")
      .delete()
      .eq("id", planId)
      .eq("user_id", user.id);
    if (deleteError) return { error: deleteError.message };

    revalidatePath("/plans");
    revalidatePath("/protected");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to delete plan" };
  }
}

export async function renamePlan(
  planId: string,
  newName: string,
): Promise<ActionResult> {
  if (!planId) return { error: "Missing plan id" };
  const trimmed = (newName ?? "").trim();
  if (!trimmed) return { error: "Name cannot be empty" };
  if (trimmed.length > 100) return { error: "Name is too long" };

  try {
    const { supabase, user, error: authError } = await getAuthedUser();
    if (authError || !user) return { error: authError ?? "Not authenticated" };

    const owns = await userOwnsPlan(supabase, user.id, planId);
    if (!owns.ok) return { error: owns.error ?? "Plan not found" };

    const { error } = await supabase
      .from("plans")
      .update({ name: trimmed, updated_at: new Date().toISOString() })
      .eq("id", planId)
      .eq("user_id", user.id);
    if (error) return { error: error.message };

    revalidatePath("/plans");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to rename plan" };
  }
}

export async function createManualPlan(
  name: string,
): Promise<{ id?: string; error?: string }> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { error: "Name cannot be empty" };
  if (trimmed.length > 100) return { error: "Name is too long" };

  try {
    const { supabase, user, error: authError } = await getAuthedUser();
    if (authError || !user) return { error: authError ?? "Not authenticated" };

    const { data, error } = await supabase
      .from("plans")
      .insert({
        user_id: user.id,
        name: trimmed,
        source: "manual",
        is_active: false,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };

    revalidatePath("/plans");
    return { id: data?.id as string | undefined };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to create plan" };
  }
}

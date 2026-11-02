"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

type FormState = { error?: string; ok?: string } | undefined;
const STEPS = ["company", "whatsapp", "team", "stages", "leads", "allocation"] as const;

async function company() {
  const { profile } = await requireAdmin();
  const db = createAdminClient();
  const { data, error } = await db.from("lb_companies").select("onboarding").eq("id", profile.company_id).single();
  if (error) throw new Error("Run the new SQL in Supabase first.");
  return { profile, db, state: (data.onboarding ?? {}) as { done?: string[] } };
}

export async function saveCompanyStep(_: FormState, form: FormData): Promise<FormState> {
  const v = z.object({
    name: z.string().trim().min(2, "Enter your company name.").max(120),
    timezone: z.string().trim().min(3).max(60),
    default_country: z.string().trim().length(2, "Pick a country."),
  }).safeParse(Object.fromEntries(form));
  if (!v.success) return { error: v.error.issues[0].message };
  try {
    const { profile, db, state } = await company();
    const done = [...new Set([...(state.done ?? []), "company"])];
    const { error } = await db.from("lb_companies").update({ ...v.data, default_country: v.data.default_country.toUpperCase(), onboarding: { ...state, done } }).eq("id", profile.company_id);
    if (error) return { error: error.message };
  } catch (e) { return { error: (e as Error).message }; }
  revalidatePath("/", "layout");
  redirect("/onboarding?step=whatsapp");
}

/** Tick a step as done (or skipped) and go to the next one. */
export async function markStep(step: string): Promise<FormState> {
  if (!(STEPS as readonly string[]).includes(step)) return { error: "Unknown step" };
  try {
    const { profile, db, state } = await company();
    const done = [...new Set([...(state.done ?? []), step])];
    const { error } = await db.from("lb_companies").update({ onboarding: { ...state, done } }).eq("id", profile.company_id);
    if (error) return { error: error.message };
  } catch (e) { return { error: (e as Error).message }; }
  const next = STEPS[STEPS.indexOf(step as (typeof STEPS)[number]) + 1];
  revalidatePath("/onboarding");
  redirect(next ? `/onboarding?step=${next}` : "/onboarding?step=finish");
}

/** Finish (or skip) the wizard: hides the setup banner for this company. */
export async function finishOnboarding(): Promise<FormState> {
  try {
    const { profile, db } = await company();
    const { error } = await db.from("lb_companies").update({ onboarded_at: new Date().toISOString() }).eq("id", profile.company_id);
    if (error) return { error: error.message };
  } catch (e) { return { error: (e as Error).message }; }
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

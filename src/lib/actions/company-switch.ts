"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Super Admin: open another company (or null = back to own company). The database checks the role too. */
export async function switchCompany(companyId: string | null): Promise<{ error: string } | void> {
  const { profile } = await requireProfile({ allowUnpaid: true });
  if (profile.role !== "super_admin") return { error: "Only the platform Super Admin can switch company." };
  const id = companyId === null ? null : z.uuid().safeParse(companyId).data;
  if (id === undefined) return { error: "Pick a company." };
  const sb = await createClient();
  const { error } = await sb.rpc("lb_switch_company", { p_company: id });
  if (error) {
    return { error: /lb_switch_company|schema cache/i.test(error.message)
      ? "Company switching needs the database update (20261102000037_lb_company_switch.sql) first."
      : error.message };
  }
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";

// Expense review. RLS + the lb_expenses trigger decide who may approve (team leader for
// their team, admin for all), who may mark paid (admin) and notify the claimant.

type Result = { error?: string; ok?: string };

export async function reviewExpenses(ids: string[], status: "approved" | "rejected" | "paid", note = ""): Promise<Result> {
  const { profile } = await requireProfile();
  const list = z.array(z.uuid()).min(1).max(200).safeParse(ids);
  if (!list.success || !["approved", "rejected", "paid"].includes(status)) return { error: "Invalid request" };
  if (status === "rejected" && !note.trim()) return { error: "Write why it is rejected" };
  const sb = await createClient();
  let done = 0;
  for (const id of list.data) {
    const { data, error } = await sb.from("lb_expenses")
      .update({ status, ...(note.trim() ? { review_note: note.trim().slice(0, 500) } : {}) })
      .eq("id", id).eq("company_id", profile.company_id).select("id");
    if (error) return { error: (done ? `${done} done, then: ` : "") + errMsg(error) };
    done += data?.length ?? 0;
  }
  revalidatePath("/field/expenses");
  revalidatePath("/field");
  if (!done) return { error: "You cannot review these expenses" };
  return { ok: `${done} expense${done === 1 ? "" : "s"} ${status}` };
}

export async function deleteExpense(id: string): Promise<Result> {
  const { profile } = await requireProfile();
  if (!z.uuid().safeParse(id).success) return { error: "Invalid request" };
  const { data, error } = await (await createClient()).from("lb_expenses").delete().eq("id", id).eq("company_id", profile.company_id).select("id");
  if (error) return { error: errMsg(error) };
  if (!data?.length) return { error: "Only a pending claim can be deleted by its owner" };
  revalidatePath("/field/expenses");
  return { ok: "Deleted" };
}

"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";

const Input = z.object({ keep: z.string().uuid(), merge: z.array(z.string().uuid()).min(1).max(20) });

export type MergePreview = {
  keep: { id: string; lead_no: number };
  merge: { id: string; lead_no: number }[];
  moves: Record<string, number>;
  fills: string[];
};

async function guard(keep: string, merge: string[]) {
  const { profile } = await requireProfile();
  if (!isAdmin(profile)) return { error: "Only a company admin can merge leads." } as const;
  const parsed = Input.safeParse({ keep, merge });
  if (!parsed.success || parsed.data.merge.includes(parsed.data.keep)) return { error: "Pick one lead to keep and at least one to merge." } as const;
  return { data: parsed.data } as const;
}

/** Read only: what a merge would move and which empty fields of the kept lead get filled. */
export async function previewMerge(keep: string, merge: string[]): Promise<{ error?: string; preview?: MergePreview }> {
  const g = await guard(keep, merge);
  if ("error" in g) return { error: g.error };
  const { data, error } = await (await createClient()).rpc("lb_merge_preview", { p_primary: g.data.keep, p_others: g.data.merge });
  if (error) return { error: errMsg(error) };
  return { preview: data as MergePreview };
}

/** Moves everything onto the kept lead and soft deletes the others (lb_merge_leads). Cannot be undone. */
export async function mergeLeads(keep: string, merge: string[]): Promise<{ error?: string; lead_no?: number; merged?: number[] }> {
  const g = await guard(keep, merge);
  if ("error" in g) return { error: g.error };
  const { data, error } = await (await createClient()).rpc("lb_merge_leads", { p_primary: g.data.keep, p_others: g.data.merge });
  if (error) return { error: errMsg(error) };
  revalidatePath("/leads");
  revalidatePath("/leads/duplicates");
  revalidatePath(`/leads/${g.data.keep}`);
  return { lead_no: data.lead_no as number, merged: data.merged as number[] };
}

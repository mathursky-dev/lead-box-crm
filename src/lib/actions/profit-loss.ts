"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";
import { syncMetaSpend } from "@/lib/meta-spend";

// Profit & Loss entries (lb_pl_entries). Manual rows are written as the signed-in admin
// (RLS: own company, admins only). Meta rows come from syncMetaSpend with the service role.

type Result = { error?: string; ok?: string };
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const Entry = z.object({
  id: z.uuid().optional(),
  kind: z.enum(["ad_cost", "sale"]),
  entry_date: z.string().regex(YMD, "Choose a date"),
  amount: z.coerce.number({ message: "Enter the amount" }).min(0, "Amount can't be negative").max(99999999999, "Amount is too large"),
  channel: z.enum(["meta", "google", "other"]).default("other"),
  source_id: z.uuid().optional(),
  note: z.string().max(500).default(""),
});

export async function savePlEntry(_: Result | undefined, fd: FormData): Promise<Result> {
  const { profile } = await requireProfile();
  if (!isAdmin(profile)) return { error: "Only admins can do this" };
  const raw = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === "string" ? v.trim() : ""]).filter(([, v]) => v !== ""));
  const p = Entry.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form" };
  const e = p.data;
  const row = { kind: e.kind, entry_date: e.entry_date, amount: e.amount, channel: e.kind === "sale" ? "other" : e.channel, source_id: e.source_id ?? null, note: e.note };
  const sb = await createClient();
  const { error } = e.id
    ? await sb.from("lb_pl_entries").update(row).eq("id", e.id).eq("company_id", profile.company_id).eq("origin", "manual")
    : await sb.from("lb_pl_entries").insert({ ...row, company_id: profile.company_id });
  if (error) return { error: errMsg(error) };
  revalidatePath("/profit-loss");
  return { ok: e.id ? "Entry updated" : e.kind === "sale" ? "Sale added" : "Ad cost added" };
}

export async function deletePlEntry(id: string): Promise<Result> {
  const { profile } = await requireProfile();
  if (!isAdmin(profile) || !z.uuid().safeParse(id).success) return { error: "Not allowed" };
  const { error } = await (await createClient()).from("lb_pl_entries").delete().eq("id", id).eq("company_id", profile.company_id).eq("origin", "manual");
  if (error) return { error: errMsg(error) };
  revalidatePath("/profit-loss");
  return { ok: "Deleted" };
}

export async function syncMetaNow(from: string, to: string): Promise<Result> {
  const { profile } = await requireProfile();
  if (!isAdmin(profile)) return { error: "Only admins can do this" };
  if (!YMD.test(from) || !YMD.test(to) || to < from) return { error: "Invalid date range" };
  const r = await syncMetaSpend(profile.company_id, from, to).catch((e) => ({ error: (e as Error).message, accounts: 0 }));
  revalidatePath("/profit-loss");
  if (r.error && !r.accounts) return { error: r.error };
  return r.error ? { error: `Partly synced: ${r.error}` } : { ok: `Synced ${r.accounts} ad account${r.accounts === 1 ? "" : "s"}` };
}

"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";

type Res = { error?: string; ok?: string };
const PATH = "/admin/allocation";
const id = z.uuid();
const ratio = z.coerce.number().int().min(1, "Ratio must be 1 or more").max(100, "Ratio can be at most 100");
const maxDay = z.union([z.literal(""), z.null(), z.undefined(), z.coerce.number().int().min(1, "Max / day must be 1 or more").max(10000)])
  .transform((v) => (v === "" || v == null ? null : v));

async function ctx() {
  const { profile: me } = await requireAdmin();
  return { me, sb: await createClient() };
}

async function audit(companyId: string, actorId: string, action: string, entityId: string | null, data: object = {}) {
  await createAdminClient().from("lb_audit_log").insert({ company_id: companyId, actor_id: actorId, action, entity: "allocation", entity_id: entityId, data });
}

/** Weights restart whenever the member list or ratios change, so the new ratio applies from the next lead. */
async function resetTurns(sb: Awaited<ReturnType<typeof createClient>>, allocId: string, companyId: string) {
  await sb.from("lb_alloc_members").update({ rr_weight: 0 }).eq("alloc_id", allocId).eq("company_id", companyId);
}

async function ownAlloc(sb: Awaited<ReturnType<typeof createClient>>, allocId: string, companyId: string) {
  const { data } = await sb.from("lb_alloc_sources").select("id").eq("id", allocId).eq("company_id", companyId).maybeSingle();
  return !!data;
}

/** Add a source (or "others") to the allocation list. */
export async function addAllocSource(source: string): Promise<Res> {
  const { me, sb } = await ctx();
  const sourceId = source === "others" ? null : id.safeParse(source).success ? source : undefined;
  if (sourceId === undefined) return { error: "Pick a source." };
  if (sourceId) {
    const { data } = await sb.from("lb_sources").select("id").eq("id", sourceId).eq("company_id", me.company_id).maybeSingle();
    if (!data) return { error: "Invalid source." };
  }
  const q = sb.from("lb_alloc_sources").select("id").eq("company_id", me.company_id);
  const { data: dupe } = await (sourceId ? q.eq("source_id", sourceId) : q.is("source_id", null)).maybeSingle();
  if (dupe) return { error: "This source is already in the list." };
  const { data, error } = await sb.from("lb_alloc_sources").insert({ company_id: me.company_id, source_id: sourceId, is_active: true }).select("id").single();
  if (error) return { error: error.message };
  await audit(me.company_id, me.id, "allocation.source_add", data.id, { source_id: sourceId });
  revalidatePath(PATH);
  return { ok: "Source added. Now add users to it." };
}

export async function setAllocSourceActive(allocId: string, active: boolean): Promise<Res> {
  const { me, sb } = await ctx();
  if (!id.safeParse(allocId).success) return { error: "Invalid source." };
  const { error } = await sb.from("lb_alloc_sources").update({ is_active: active }).eq("id", allocId).eq("company_id", me.company_id);
  if (error) return { error: error.message };
  await audit(me.company_id, me.id, active ? "allocation.source_on" : "allocation.source_off", allocId);
  revalidatePath(PATH);
  return { ok: active ? "Allocation on." : "Allocation off." };
}

export async function deleteAllocSource(allocId: string): Promise<Res> {
  const { me, sb } = await ctx();
  if (!id.safeParse(allocId).success) return { error: "Invalid source." };
  const { error } = await sb.from("lb_alloc_sources").delete().eq("id", allocId).eq("company_id", me.company_id);
  if (error) return { error: error.message };
  await audit(me.company_id, me.id, "allocation.source_delete", allocId);
  revalidatePath(PATH);
  return { ok: "Removed." };
}

export async function addAllocMember(allocId: string, input: { userId: string; ratio: string; maxPerDay: string }): Promise<Res> {
  const { me, sb } = await ctx();
  const p = z.object({ allocId: id, userId: z.uuid("Select a user"), ratio, maxPerDay: maxDay })
    .safeParse({ allocId, userId: input.userId, ratio: input.ratio || "1", maxPerDay: input.maxPerDay });
  if (!p.success) return { error: p.error.issues[0]?.message };
  if (!(await ownAlloc(sb, allocId, me.company_id))) return { error: "Invalid source." };
  const { data: user } = await sb.from("lb_profiles").select("id").eq("id", p.data.userId).eq("company_id", me.company_id).maybeSingle();
  if (!user) return { error: "Invalid user." };
  const { error } = await sb.from("lb_alloc_members").insert({
    alloc_id: allocId, company_id: me.company_id, user_id: p.data.userId, ratio: p.data.ratio, max_per_day: p.data.maxPerDay,
  });
  if (error) return { error: error.code === "23505" ? "This user is already added." : error.message };
  await resetTurns(sb, allocId, me.company_id);
  await audit(me.company_id, me.id, "allocation.user_add", allocId, p.data);
  revalidatePath(PATH);
  return { ok: "User added." };
}

export async function updateAllocMember(memberId: string, input: { ratio: string; maxPerDay: string }): Promise<Res> {
  const { me, sb } = await ctx();
  const p = z.object({ memberId: id, ratio, maxPerDay: maxDay }).safeParse({ memberId, ratio: input.ratio, maxPerDay: input.maxPerDay });
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { data, error } = await sb.from("lb_alloc_members").update({ ratio: p.data.ratio, max_per_day: p.data.maxPerDay })
    .eq("id", memberId).eq("company_id", me.company_id).select("alloc_id").single();
  if (error) return { error: error.message };
  await resetTurns(sb, data.alloc_id, me.company_id);
  await audit(me.company_id, me.id, "allocation.user_update", data.alloc_id, p.data);
  revalidatePath(PATH);
  return { ok: "Saved." };
}

export async function setAllocMemberActive(memberId: string, active: boolean): Promise<Res> {
  const { me, sb } = await ctx();
  if (!id.safeParse(memberId).success) return { error: "Invalid user." };
  const { data, error } = await sb.from("lb_alloc_members").update({ is_active: active })
    .eq("id", memberId).eq("company_id", me.company_id).select("alloc_id").single();
  if (error) return { error: error.message };
  await resetTurns(sb, data.alloc_id, me.company_id);
  await audit(me.company_id, me.id, active ? "allocation.user_on" : "allocation.user_off", data.alloc_id, { member_id: memberId });
  revalidatePath(PATH);
  return { ok: active ? "User on." : "User off." };
}

export async function deleteAllocMember(memberId: string): Promise<Res> {
  const { me, sb } = await ctx();
  if (!id.safeParse(memberId).success) return { error: "Invalid user." };
  const { data, error } = await sb.from("lb_alloc_members").delete().eq("id", memberId).eq("company_id", me.company_id).select("alloc_id").single();
  if (error) return { error: error.message };
  await resetTurns(sb, data.alloc_id, me.company_id);
  await audit(me.company_id, me.id, "allocation.user_delete", data.alloc_id, { member_id: memberId });
  revalidatePath(PATH);
  return { ok: "Removed." };
}

/** Hand this source's unassigned open leads out now (oldest first), until everyone is at their limit. */
export async function assignWaiting(allocId: string): Promise<Res> {
  const { me, sb } = await ctx();
  if (!id.safeParse(allocId).success || !(await ownAlloc(sb, allocId, me.company_id))) return { error: "Invalid source." };
  const { data, error } = await sb.rpc("lb_alloc_assign_waiting", { p_alloc: allocId, p_max: 500 });
  if (error) return { error: error.message };
  await audit(me.company_id, me.id, "allocation.assign_waiting", allocId, { assigned: data });
  revalidatePath(PATH);
  revalidatePath("/leads");
  return { ok: data ? `${data} waiting lead(s) assigned.` : "No lead could be assigned: none waiting, or every user is off, away or at their limit." };
}

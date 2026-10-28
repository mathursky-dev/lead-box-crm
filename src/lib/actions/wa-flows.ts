"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireProfile } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";
import { normalizeGraph, validateGraph } from "@/lib/wa-flow";

type Result = { error?: string; ok?: string; id?: string; version?: number };

const meta = z.object({
  id: z.uuid().nullable(),
  name: z.string().trim().min(1, "Give the flow a name").max(120),
  description: z.string().trim().max(500).nullable().transform((v) => v || null),
  trigger_type: z.enum(["keywords", "any", "new_contact", "manual"]),
  keywords: z.array(z.string().trim().min(1).max(60)).max(50),
  match_type: z.enum(["exact", "contains", "starts"]),
  number_id: z.uuid().nullable(),
  tag_names: z.array(z.string().trim().min(1).max(40)).max(20),
  priority: z.coerce.number().int().min(1).max(9999),
  is_active: z.boolean(),
  note: z.string().trim().max(200).optional(),
});
export type FlowMeta = z.output<typeof meta>;

async function audit(companyId: string, actorId: string, action: string, entityId: string, data: object = {}) {
  await createAdminClient().from("lb_audit_log").insert({ company_id: companyId, actor_id: actorId, action, entity: "wa_flow", entity_id: entityId, data }).then(() => {}, () => {});
}

/** Saves the flow and keeps a version snapshot (last 30). Activating requires a graph without errors. */
export async function saveFlow(input: FlowMeta, rawGraph: unknown): Promise<Result> {
  const { profile: me } = await requireAdmin();
  const p = meta.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { id, note, ...v } = p.data;
  const graph = normalizeGraph(rawGraph);
  if (JSON.stringify(graph).length > 500_000) return { error: "Flow is too large." };
  if (v.trigger_type === "keywords" && !v.keywords.length && v.is_active) return { error: "Add at least one trigger keyword, or change the trigger." };
  const errors = validateGraph(graph).filter((i) => i.level === "error");
  if (v.is_active && errors.length) return { error: `Fix ${errors.length} problem${errors.length > 1 ? "s" : ""} before turning the flow on: ${errors[0].text}` };
  const sb = await createClient();
  const row = { ...v, graph, updated_by: me.id, updated_at: new Date().toISOString() };
  let flowId = id, version = 1;
  if (id) {
    const { data: cur, error: e0 } = await sb.from("lb_wa_flows").select("version").eq("id", id).single();
    if (e0 || !cur) return { error: "Flow not found." };
    version = cur.version + 1;
    const { error } = await sb.from("lb_wa_flows").update({ ...row, version }).eq("id", id);
    if (error) return { error: errMsg(error) };
  } else {
    const { data, error } = await sb.from("lb_wa_flows").insert({ ...row, version, company_id: me.company_id, created_by: me.id }).select("id").single();
    if (error) return { error: errMsg(error) };
    flowId = data.id;
  }
  await sb.from("lb_wa_flow_versions").insert({ flow_id: flowId, company_id: me.company_id, version, snapshot: { ...v, graph }, note: note || null, created_by: me.id });
  const db = createAdminClient();
  const { data: old } = await db.from("lb_wa_flow_versions").select("id").eq("flow_id", flowId!).order("version", { ascending: false }).range(30, 200);
  if (old?.length) await db.from("lb_wa_flow_versions").delete().in("id", old.map((o) => o.id));
  await audit(me.company_id, me.id, id ? "wa_flow.update" : "wa_flow.create", flowId!, { name: v.name, version, active: v.is_active });
  revalidatePath("/whatsapp/flows");
  return { ok: `Saved · version ${version}`, id: flowId!, version };
}

export async function toggleFlow(id: string, active: boolean): Promise<Result> {
  await requireAdmin();
  const sb = await createClient();
  if (active) {
    const { data: f } = await sb.from("lb_wa_flows").select("graph").eq("id", id).single();
    const errors = validateGraph(normalizeGraph(f?.graph)).filter((i) => i.level === "error");
    if (errors.length) return { error: `Open the editor and fix: ${errors[0].text}` };
  }
  const { error } = await sb.from("lb_wa_flows").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: errMsg(error) };
  if (!active) await createAdminClient().from("lb_wa_flow_sessions").update({ status: "stopped" }).eq("flow_id", id).eq("status", "waiting");
  revalidatePath("/whatsapp/flows");
  return { ok: active ? "Flow on." : "Flow off." };
}

export async function deleteFlow(id: string): Promise<Result> {
  const { profile: me } = await requireAdmin();
  const { error } = await (await createClient()).from("lb_wa_flows").delete().eq("id", id);
  if (error) return { error: errMsg(error) };
  await audit(me.company_id, me.id, "wa_flow.delete", id);
  revalidatePath("/whatsapp/flows");
  return { ok: "Deleted." };
}

export async function duplicateFlow(id: string): Promise<Result> {
  const { profile: me } = await requireAdmin();
  const sb = await createClient();
  const { data: f } = await sb.from("lb_wa_flows").select("name,description,trigger_type,keywords,match_type,number_id,tag_names,priority,graph").eq("id", id).single();
  if (!f) return { error: "Flow not found." };
  const { data, error } = await sb.from("lb_wa_flows").insert({ ...f, name: `${f.name} (copy)`.slice(0, 120), is_active: false, version: 0, company_id: me.company_id, created_by: me.id, updated_by: me.id }).select("id").single();
  if (error) return { error: errMsg(error) };
  revalidatePath("/whatsapp/flows");
  return { ok: "Copied.", id: data.id };
}

export async function listFlowVersions(id: string) {
  await requireProfile();
  const { data } = await (await createClient()).from("lb_wa_flow_versions")
    .select("id,version,note,created_at,snapshot,author:lb_profiles(full_name)").eq("flow_id", id).order("version", { ascending: false }).limit(30);
  return (data ?? []).map((v) => ({ id: v.id, version: v.version, note: v.note, created_at: v.created_at, snapshot: v.snapshot as Record<string, unknown>,
    author: (v.author as unknown as { full_name: string } | null)?.full_name ?? "" }));
}

export async function flowStats(id: string) {
  await requireProfile();
  const { data, error } = await (await createClient()).rpc("lb_wa_flow_stats", { p_flow: id, p_days: 30 });
  if (error) return null;
  return data as { nodes: Record<string, number>; started: number; completed: number; handoff: number; waiting: number; invalid: number };
}

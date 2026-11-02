"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { pageBlocked, requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";
import { fromLocalInput } from "@/lib/dates";
import { TASK_STATUSES } from "@/lib/tasks";

// Tasks (lb_tasks). Writes run as the signed-in user: RLS keeps them inside the
// active company and to tasks the user can see; a trigger checks the assignee and
// lead belong to the same company and notifies the assignee.

type Result = { error?: string; ok?: string };
const STATUS = z.enum(TASK_STATUSES.map((s) => s.value) as [string, ...string[]]);

const TaskForm = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(1, "Write the task").max(200),
  description: z.string().max(4000).default(""),
  assigned_to: z.uuid("Choose who does it"),
  status: STATUS.default("created"),
  priority: z.coerce.number().int().min(1).max(5).default(3),
  due: z.string().max(20).default(""),
  lead_id: z.uuid().optional(),
});

/** Add or edit a task (used by the task form; FormData from ActionForm). */
export async function saveTask(_: Result | undefined, fd: FormData): Promise<Result> {
  { const blocked = await pageBlocked("tasks", "edit"); if (blocked) return { error: blocked }; }
  const { profile } = await requireProfile();
  const raw = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]).filter(([, v]) => v !== ""));
  const p = TaskForm.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form" };
  const t = p.data;
  const row = {
    title: t.title, description: t.description.trim(), assigned_to: t.assigned_to, status: t.status, priority: t.priority,
    due_at: t.due ? fromLocalInput(t.due.length === 10 ? `${t.due}T18:00` : t.due) : null, lead_id: t.lead_id ?? null,
  };
  const sb = await createClient();
  const { error } = t.id
    ? await sb.from("lb_tasks").update(row).eq("id", t.id).eq("company_id", profile.company_id)
    : await sb.from("lb_tasks").insert({ ...row, company_id: profile.company_id, assigned_by: profile.id });
  if (error) return { error: errMsg(error) };
  revalidatePath("/tasks");
  return { ok: t.id ? "Task updated" : "Task added" };
}

/** Change the status of one or more tasks (row dropdown and bulk Actions). */
export async function setTaskStatus(ids: string[], status: string): Promise<{ error?: string; n?: number }> {
  { const blocked = await pageBlocked("tasks", "edit"); if (blocked) return { error: blocked }; }
  const { profile } = await requireProfile();
  const s = STATUS.safeParse(status);
  const list = z.array(z.uuid()).min(1).max(500).safeParse(ids);
  if (!s.success || !list.success) return { error: "Invalid request" };
  const { data, error } = await (await createClient()).from("lb_tasks").update({ status: s.data })
    .in("id", list.data).eq("company_id", profile.company_id).select("id");
  if (error) return { error: errMsg(error) };
  revalidatePath("/tasks");
  return { n: data?.length ?? 0 };
}

/** Reassign one or more tasks. */
export async function assignTasks(ids: string[], userId: string): Promise<{ error?: string; n?: number }> {
  { const blocked = await pageBlocked("tasks", "edit"); if (blocked) return { error: blocked }; }
  const { profile } = await requireProfile();
  const list = z.array(z.uuid()).min(1).max(500).safeParse(ids);
  if (!list.success || !z.uuid().safeParse(userId).success) return { error: "Invalid request" };
  const { data, error } = await (await createClient()).from("lb_tasks").update({ assigned_to: userId })
    .in("id", list.data).eq("company_id", profile.company_id).select("id");
  if (error) return { error: errMsg(error) };
  revalidatePath("/tasks");
  return { n: data?.length ?? 0 };
}

/** Delete tasks. Only the creator or an admin can (RLS); others are skipped. */
export async function deleteTasks(ids: string[]): Promise<{ error?: string; n?: number }> {
  { const blocked = await pageBlocked("tasks", "delete"); if (blocked) return { error: blocked }; }
  const { profile } = await requireProfile();
  const list = z.array(z.uuid()).min(1).max(500).safeParse(ids);
  if (!list.success) return { error: "Invalid request" };
  const { data, error } = await (await createClient()).from("lb_tasks").delete()
    .in("id", list.data).eq("company_id", profile.company_id).select("id");
  if (error) return { error: errMsg(error) };
  revalidatePath("/tasks");
  return { n: data?.length ?? 0 };
}

export type LeadHit = { id: string; lead_no: number; name: string | null; phone: string };

/** Lead picker in the task form: search by name, phone or LB-number among leads the user can see. */
export async function searchTaskLeads(q: string): Promise<LeadHit[]> {
  const { profile } = await requireProfile();
  const term = String(q ?? "").replace(/[%_,()\\*]/g, " ").trim().slice(0, 60);
  if (term.length < 2) return [];
  const sb = await createClient();
  const no = term.replace(/^lb-?/i, "");
  let qy = sb.from("lb_leads").select("id,lead_no,customer:lb_customers!inner(name,phone_e164)")
    .eq("company_id", profile.company_id).order("last_activity_at", { ascending: false }).limit(8);
  if (/^\d{1,9}$/.test(no) && no.length < 6) qy = qy.eq("lead_no", Number(no));
  else qy = qy.or(`name.ilike.%${term}%,phone_e164.ilike.%${term.replace(/\D/g, "") || term}%`, { referencedTable: "customer" });
  const { data } = await qy;
  return (data ?? []).map((r) => {
    const c = r.customer as unknown as { name: string | null; phone_e164: string };
    return { id: r.id as string, lead_no: r.lead_no as number, name: c?.name ?? null, phone: c?.phone_e164 ?? "" };
  });
}

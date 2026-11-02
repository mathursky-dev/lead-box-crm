"use server";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireProfile, isManager, can } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { errMsg, normalizePhone } from "@/lib/util";
import { demoBlocked } from "@/lib/demo";
import { createGroup, deleteGroup, refreshGroup, removeParticipant, resetInviteLink, sendToGroup } from "@/lib/wa-groups";
import { sendText } from "./inbox";

type FormState = { error?: string; ok?: string } | undefined;

/** Managers (admin / team leader) with send permission run groups. Every write is filtered by company_id. */
async function gate() {
  const { profile } = await requireProfile();
  if (!isManager(profile) || !can(profile, "chats.send")) throw new Error("Only admins and team leaders can manage WhatsApp groups.");
  if (!hasServiceRole()) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing on the server.");
  const demo = await demoBlocked(profile.company_id);
  if (demo) throw new Error(demo);
  return { me: profile, db: createAdminClient() };
}

async function own(db: ReturnType<typeof createAdminClient>, id: string, companyId: string) {
  if (!z.uuid().safeParse(id).success) throw new Error("Invalid group");
  const { data } = await db.from("lb_wa_groups").select("id").eq("id", id).eq("company_id", companyId).maybeSingle();
  if (!data) throw new Error("Group not found");
}

async function audit(db: ReturnType<typeof createAdminClient>, companyId: string, actor: string, action: string, id: string, data: object = {}) {
  await db.from("lb_audit_log").insert({ company_id: companyId, actor_id: actor, action, entity: "wa_group", entity_id: id, data }).then(() => {}, () => {});
}

export async function createGroupAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await gate();
    const p = z.object({
      number_id: z.uuid("Pick a WhatsApp number"),
      subject: z.string().trim().min(1, "Group name is required").max(128),
      description: z.string().trim().max(2048).default(""),
    }).safeParse(Object.fromEntries(form));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form." };
    const { data: n } = await db.from("lb_wa_numbers").select("id,provider,is_active").eq("id", p.data.number_id).eq("company_id", me.company_id).maybeSingle();
    if (!n || !n.is_active) return { error: "That number is not active." };
    const id = await createGroup({ companyId: me.company_id, numberId: n.id, subject: p.data.subject, description: p.data.description,
      approval: form.get("approval") === "on", leadId: null, actor: me.id });
    await audit(db, me.company_id, me.id, "wa_group.create", id, { subject: p.data.subject });
    revalidatePath("/whatsapp/groups");
    return { ok: "Group requested from WhatsApp. The invite link appears in a few seconds (tap Refresh if it does not)." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function refreshGroupAction(id: string): Promise<FormState> {
  try {
    const { me, db } = await gate();
    await own(db, id, me.company_id);
    const ok = await refreshGroup(db, id);
    revalidatePath("/whatsapp/groups", "layout");
    return { ok: ok ? "Updated from WhatsApp." : "WhatsApp is still creating this group. Try again in a minute." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function resetLinkAction(id: string): Promise<FormState> {
  try {
    const { me, db } = await gate();
    await own(db, id, me.company_id);
    await resetInviteLink(db, id);
    await audit(db, me.company_id, me.id, "wa_group.reset_link", id);
    revalidatePath("/whatsapp/groups", "layout");
    return { ok: "New invite link made. Old links stop working." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function deleteGroupAction(id: string): Promise<FormState> {
  try {
    const { me, db } = await gate();
    await own(db, id, me.company_id);
    await deleteGroup(db, id);
    await audit(db, me.company_id, me.id, "wa_group.delete", id);
    revalidatePath("/whatsapp/groups", "layout");
    return { ok: "Group deleted on WhatsApp." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function removeMemberAction(id: string, waId: string): Promise<FormState> {
  try {
    const { me, db } = await gate();
    await own(db, id, me.company_id);
    if (!/^[0-9]{7,15}$/.test(waId)) return { error: "Invalid number" };
    await removeParticipant(db, id, waId);
    await audit(db, me.company_id, me.id, "wa_group.remove_member", id, { wa_id: waId });
    revalidatePath(`/whatsapp/groups/${id}`);
    return { ok: "Removed. They cannot rejoin with the old link." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function sendGroupMessageAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await gate();
    const p = z.object({
      group_id: z.uuid(),
      text: z.string().trim().max(4096).default(""),
      media_url: z.union([z.url({ protocol: /^https$/ }), z.literal("")]).default("").transform((v) => v || null),
      media_type: z.enum(["image", "document", "video"]).default("image"),
    }).safeParse(Object.fromEntries(form));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the message." };
    if (!p.data.text && !p.data.media_url) return { error: "Write a message or add a file link." };
    await own(db, p.data.group_id, me.company_id);
    await sendToGroup(db, { groupId: p.data.group_id, companyId: me.company_id, actor: me.id, text: p.data.text, mediaUrl: p.data.media_url, mediaType: p.data.media_type });
    revalidatePath(`/whatsapp/groups/${p.data.group_id}`);
    return { ok: "Sent to the group." };
  } catch (e) {
    revalidatePath("/whatsapp/groups", "layout");
    return { error: errMsg(e) };
  }
}

/** Many groups at once (same text), e.g. a price update to every dealer group. */
export async function sendManyGroupsAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await gate();
    const ids = form.getAll("group_ids").map(String).filter((v) => z.uuid().safeParse(v).success).slice(0, 100);
    const text = String(form.get("text") ?? "").trim().slice(0, 4096);
    if (!ids.length) return { error: "Tick at least one group." };
    if (!text) return { error: "Write the message." };
    let ok = 0; const failed: string[] = [];
    for (const id of ids) {
      try { await own(db, id, me.company_id); await sendToGroup(db, { groupId: id, companyId: me.company_id, actor: me.id, text }); ok++; }
      catch (e) { failed.push(errMsg(e)); }
    }
    await audit(db, me.company_id, me.id, "wa_group.broadcast", ids.join(","), { groups: ids.length, ok });
    revalidatePath("/whatsapp/groups", "layout");
    return failed.length ? { error: `Sent to ${ok} of ${ids.length} groups. First problem: ${failed[0]}` } : { ok: `Sent to ${ok} group${ok === 1 ? "" : "s"}.` };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/** Sends the invite link to a contact's existing WhatsApp chat (works inside the 24-hour window). */
export async function inviteContactAction(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me, db } = await gate();
    const id = String(form.get("group_id") ?? "");
    await own(db, id, me.company_id);
    const phone = normalizePhone(String(form.get("phone") ?? ""));
    if (!phone) return { error: "Enter a valid mobile number with country code." };
    const { data: g } = await db.from("lb_wa_groups").select("subject,invite_link,number_id").eq("id", id).single();
    if (!g?.invite_link) return { error: "No invite link yet. Tap Refresh first." };
    const { data: cust } = await db.from("lb_customers").select("id").eq("company_id", me.company_id).eq("phone_e164", phone).maybeSingle();
    const { data: conv } = cust
      ? await db.from("lb_conversations").select("id").eq("customer_id", cust.id).eq("number_id", g.number_id).order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
      : { data: null };
    if (!conv) return { error: "No WhatsApp chat with this number on the group's number yet. Copy the link and send it from the chat or a template." };
    const r = await sendText(conv.id, randomUUID(), `Join our WhatsApp group "${g.subject}": ${g.invite_link}`);
    if (r.error) return { error: r.error };
    return { ok: "Invite link sent in their chat. If the last message from them is older than 24 hours, WhatsApp needs a template instead." };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

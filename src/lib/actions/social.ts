"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireProfile, can, isManager } from "@/lib/auth";
import { createAdminClient, createClient, hasServiceRole } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret, errMsg, normalizePhone } from "@/lib/util";
import { demoBlocked } from "@/lib/demo";
import { fbAccount } from "@/lib/facebook";
import { graph } from "@/lib/whatsapp";
import { fillProfile, sendSocialText, type SocialChannel } from "@/lib/social";

type Res = { error?: string; ok?: string };
const Uuid = z.uuid();
const NOT_READY = "Instagram / Messenger inbox is not set up yet: run its SQL once in Supabase.";
const fail = (e: unknown): Res => { const m = errMsg(e); return { error: /lb_social|messenger_enabled|ig_enabled|schema cache/i.test(m) ? NOT_READY : m }; };

/** A thread the user can see (their own RLS decides), plus the fields actions need. */
async function myThread(id: string) {
  const { profile } = await requireProfile();
  if (!Uuid.safeParse(id).success) return { error: "Invalid chat" } as const;
  if (!hasServiceRole()) return { error: "Server not configured" } as const;
  const { data: t } = await (await createClient()).from("lb_social_threads")
    .select("id,company_id,channel,page_id,psid,name,username,lead_id,assignee_id,last_inbound_at,unread_count").eq("id", id).maybeSingle();
  if (!t || t.company_id !== profile.company_id) return { error: "Chat not found" } as const;
  return { profile, t, db: createAdminClient() };
}

export async function sendSocialMessage(threadId: string, clientId: string, text: string): Promise<Res> {
  const o = await myThread(threadId);
  if ("error" in o) return { error: o.error };
  if (!can(o.profile, "chats.send")) return { error: "You can't send messages." };
  const body = String(text ?? "").trim().slice(0, 1000);
  if (!body) return { error: "Type a message" };
  if (!Uuid.safeParse(clientId).success) return { error: "Invalid draft" };
  const { data: row, error } = await o.db.from("lb_social_messages").insert({
    company_id: o.t.company_id, thread_id: o.t.id, direction: "out", body, client_id: clientId, status: "sending", sent_by: o.profile.id,
  }).select("id").single();
  if (error) return error.code === "23505" ? { ok: "Already sent." } : fail(error);
  const r = await sendSocialText(o.t as { page_id: string; psid: string; last_inbound_at: string | null }, body);
  await o.db.from("lb_social_messages").update(r.error ? { status: "failed", error_message: r.error.slice(0, 300) } : { status: "sent", mid: r.mid ?? null }).eq("id", row.id);
  if (!r.error) {
    await o.db.from("lb_social_threads").update({ last_message_at: new Date().toISOString(), last_message_preview: body.slice(0, 140), updated_at: new Date().toISOString(),
      ...(o.t.assignee_id ? {} : { assignee_id: o.profile.id }) }).eq("id", o.t.id);
    if (o.t.lead_id) {
      await o.db.from("lb_lead_events").insert({ company_id: o.t.company_id, lead_id: o.t.lead_id, actor_id: o.profile.id, type: "message_out", is_work: true,
        data: { body: body.slice(0, 140), channel: o.t.channel, thread_id: o.t.id } });
    }
  }
  return r.error ? { error: r.error } : { ok: "Sent" };
}

export async function socialThreadAction(threadId: string, action: "read" | "status" | "assign" | "note", data: { status?: string; user?: string | null; body?: string } = {}): Promise<Res> {
  const o = await myThread(threadId);
  if ("error" in o) return { error: o.error };
  const now = new Date().toISOString();
  try {
    if (action === "read") {
      if (o.t.unread_count > 0) await o.db.from("lb_social_threads").update({ unread_count: 0 }).eq("id", o.t.id);
      return { ok: "" };
    }
    if (action === "status") {
      if (!["open", "pending", "resolved"].includes(data.status ?? "")) return { error: "Invalid status" };
      const { error } = await o.db.from("lb_social_threads").update({ status: data.status, updated_at: now }).eq("id", o.t.id);
      return error ? fail(error) : { ok: "Saved" };
    }
    if (action === "assign") {
      if (!isManager(o.profile) && !can(o.profile, "chats.transfer")) return { error: "You can't transfer chats." };
      const user = data.user || null;
      if (user) {
        if (!Uuid.safeParse(user).success) return { error: "Invalid user" };
        const { data: u } = await o.db.from("lb_profiles").select("id").eq("id", user).eq("company_id", o.t.company_id).eq("is_active", true).maybeSingle();
        if (!u) return { error: "User not found" };
      }
      const { error } = await o.db.from("lb_social_threads").update({ assignee_id: user, updated_at: now }).eq("id", o.t.id);
      if (error) return fail(error);
      if (user && user !== o.profile.id) {
        await o.db.from("lb_notifications").insert({ company_id: o.t.company_id, user_id: user, type: "message", title: `${o.t.channel === "instagram" ? "Instagram" : "Messenger"} chat assigned to you`,
          body: o.t.name ?? o.t.username ?? "Customer", link: `/inbox?ch=${o.t.channel}&t=${o.t.id}`, dedupe_key: `socassign:${o.t.id}:${user}:${now}` });
      }
      return { ok: "Assigned" };
    }
    if (action === "note") {
      const body = String(data.body ?? "").trim().slice(0, 2000);
      if (!body) return { error: "Type a note" };
      const { error } = await o.db.from("lb_social_messages").insert({ company_id: o.t.company_id, thread_id: o.t.id, direction: "note", body, status: "sent", sent_by: o.profile.id });
      return error ? fail(error) : { ok: "Note added" };
    }
    return { error: "Unknown action" };
  } catch (e) { return fail(e); }
}

/** New (or existing open) lead for the customer's phone number, linked to this chat. */
export async function socialCreateLead(threadId: string, phoneRaw: string, name: string): Promise<Res & { leadId?: string }> {
  const o = await myThread(threadId);
  if ("error" in o) return { error: o.error };
  if (!can(o.profile, "leads.create")) return { error: "You can't create leads." };
  const { data: co } = await o.db.from("lb_companies").select("default_country").eq("id", o.t.company_id).maybeSingle();
  const phone = normalizePhone(String(phoneRaw ?? ""), (co?.default_country as string) ?? "IN");
  if (!phone) return { error: "Enter the customer's mobile number." };
  const { data, error } = await o.db.rpc("lb_social_lead", { p_thread: o.t.id, p_phone: phone, p_name: String(name ?? "").trim().slice(0, 120) });
  if (error) return fail(error);
  const leadId = (data as { lead_id: string }).lead_id;
  revalidatePath(`/leads/${leadId}`);
  return { ok: (data as { new_lead?: boolean }).new_lead ? "Lead created." : "Linked to the customer's open lead.", leadId };
}

/** Link the chat to an existing lead by its number (LB-123). */
export async function socialLinkLead(threadId: string, leadNo: string): Promise<Res & { leadId?: string }> {
  const o = await myThread(threadId);
  if ("error" in o) return { error: o.error };
  const n = Number(String(leadNo ?? "").replace(/^LB-?/i, "").trim());
  if (!Number.isInteger(n) || n <= 0) return { error: "Enter a lead number like LB-123." };
  const { data: lead } = await (await createClient()).from("lb_leads").select("id,owner_id,company_id").eq("lead_no", n).eq("company_id", o.t.company_id).maybeSingle();
  if (!lead) return { error: "Lead not found." };
  const { error } = await o.db.from("lb_social_threads").update({ lead_id: lead.id, assignee_id: o.t.assignee_id ?? lead.owner_id, updated_at: new Date().toISOString() }).eq("id", o.t.id);
  if (error) return fail(error);
  return { ok: "Linked.", leadId: lead.id as string };
}

export async function socialUnlinkLead(threadId: string): Promise<Res> {
  const o = await myThread(threadId);
  if ("error" in o) return { error: o.error };
  const { error } = await o.db.from("lb_social_threads").update({ lead_id: null, updated_at: new Date().toISOString() }).eq("id", o.t.id);
  return error ? fail(error) : { ok: "Unlinked." };
}

export async function refreshSocialProfile(threadId: string): Promise<Res> {
  const o = await myThread(threadId);
  if ("error" in o) return { error: o.error };
  await fillProfile(o.t.id);
  return { ok: "" };
}

// ------------------------------------------------------------ admin: pages

/** Turn Messenger or Instagram on/off for one Facebook page of the connected account. */
export async function setSocialChannel(pageId: string, channel: SocialChannel, on: boolean): Promise<Res> {
  if (!/^\d{3,30}$/.test(pageId) || !["messenger", "instagram"].includes(channel)) return { error: "Invalid page" };
  try {
    const { profile: me } = await requireAdmin();
    const demo = await demoBlocked(me.company_id);
    if (demo) return { error: demo };
    if (!hasServiceRole() || !process.env.LB_SECRETS_KEY) return { error: "Server is not configured: SUPABASE_SERVICE_ROLE_KEY / LB_SECRETS_KEY missing." };
    const acct = await fbAccount(me.company_id);
    if (!acct) return { error: "Connect Facebook first." };
    const db = createAdminClient();
    const { data: other } = await db.from("lb_fb_pages").select("company_id").eq("page_id", pageId).neq("company_id", me.company_id).maybeSingle();
    if (other) return { error: "This page is connected to another company." };

    const { data: existing } = await db.from("lb_fb_pages").select("*").eq("company_id", me.company_id).eq("page_id", pageId).maybeSingle();
    let token = existing?.page_token_enc ? decryptSecret(existing.page_token_enc) : null;
    let pageName = existing?.page_name as string | null;
    if (on || !token) {
      const r = await graph<{ data: { id: string; name: string; access_token: string }[] }>(acct.token, "me/accounts?fields=id,name,access_token&limit=100");
      if (!r.ok) return { error: `Facebook: ${r.message}` };
      const p = r.data.data.find((x) => x.id === pageId);
      if (!p) return { error: "This Facebook account does not manage that page." };
      token = p.access_token; pageName = p.name;
    }
    const patch: Record<string, unknown> = { [channel === "messenger" ? "messenger_enabled" : "ig_enabled"]: on };
    if (channel === "instagram" && on) {
      const ig = await graph<{ instagram_business_account?: { id: string; username?: string } }>(token!, `${pageId}?fields=instagram_business_account{id,username}`);
      if (!ig.ok) return { error: `Facebook: ${ig.message}` };
      if (!ig.data.instagram_business_account?.id) return { error: "No Instagram professional account is linked to this page. Link it in Instagram → Settings → Linked accounts / Meta Business Suite." };
      const { data: igOther } = await db.from("lb_fb_pages").select("company_id").eq("ig_user_id", ig.data.instagram_business_account.id).neq("company_id", me.company_id).maybeSingle();
      if (igOther) return { error: "This Instagram account is connected to another company." };
      patch.ig_user_id = ig.data.instagram_business_account.id;
      patch.ig_username = ig.data.instagram_business_account.username ?? null;
    }
    const messenger = channel === "messenger" ? on : Boolean(existing?.messenger_enabled);
    const insta = channel === "instagram" ? on : Boolean(existing?.ig_enabled);
    // Keep the Lead Ads subscription as it was; add messaging fields while any chat channel is on.
    const fields = [existing?.subscribed ? "leadgen" : null, ...(messenger || insta ? ["messages", "messaging_postbacks"] : [])].filter(Boolean).join(",");
    const sub = fields
      ? await graph(token!, `${pageId}/subscribed_apps?subscribed_fields=${fields}`, { method: "POST" })
      : await graph(token!, `${pageId}/subscribed_apps`, { method: "DELETE" });
    if (on && !sub.ok) return { error: `Meta refused the subscription: ${sub.message}. Click “Grant messaging permission” and try again.` };
    const { error } = existing
      ? await db.from("lb_fb_pages").update({ ...patch, page_token_enc: encryptSecret(token!), page_name: pageName }).eq("id", existing.id)
      : await db.from("lb_fb_pages").insert({ company_id: me.company_id, page_id: pageId, page_name: pageName, page_token_enc: encryptSecret(token!), subscribed: false, is_selected: false, ...patch });
    if (error) return fail(error);
    await db.from("lb_audit_log").insert({ company_id: me.company_id, actor_id: me.id, action: `integration.${channel}.${on ? "on" : "off"}`, entity: "integration", entity_id: pageId, data: {} });
    revalidatePath("/admin/social");
    revalidatePath("/inbox");
    return { ok: on ? `${channel === "instagram" ? "Instagram" : "Messenger"} is on. New messages will show in the Inbox.` : "Turned off." };
  } catch (e) { return fail(e); }
}

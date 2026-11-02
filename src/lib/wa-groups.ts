import "server-only";
import { createAdminClient } from "./supabase/server";
import { graph, numberCredentials } from "./whatsapp";

// WhatsApp groups through Meta's official Groups API (Cloud API numbers only).
// Limits set by Meta: Official Business Account number, max 8 participants, people join only through
// the invite link, text / media / templates only, no Communities.

export const GROUP_MAX_PARTICIPANTS = 8;

type Db = ReturnType<typeof createAdminClient>;

async function creds(numberId: string) {
  const c = await numberCredentials(numberId);
  if (!c) throw new Error("This number is not connected (or its token is missing).");
  if ((c as { provider?: string }).provider === "qr") throw new Error("Groups need an official Cloud API number. QR-scan numbers cannot run groups from the CRM.");
  return c;
}

/** Explains Meta's common refusals in plain words. */
function why(msg: string) {
  if (/permission|not eligible|official business|OBA|\(#10\)|\(#200\)|unsupported/i.test(msg))
    return `${msg} · Meta allows groups only on numbers with an Official Business Account (green tick). Check the number in Meta Business Settings.`;
  return msg;
}

export async function createGroup(o: { companyId: string; numberId: string; subject: string; description: string; approval: boolean; leadId: string | null; actor: string }) {
  const db = createAdminClient();
  const c = await creds(o.numberId);
  const r = await graph<{ request_id?: string; id?: string; group_id?: string }>(c.token, `${c.endpoint}/groups`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", subject: o.subject, ...(o.description ? { description: o.description } : {}),
      join_approval_mode: o.approval ? "approval_required" : "auto_approve" }),
  });
  if (!r.ok) throw new Error(why(r.message));
  const waId = r.data.group_id ?? r.data.id ?? null;
  const { data, error } = await db.from("lb_wa_groups").insert({
    company_id: o.companyId, number_id: o.numberId, subject: o.subject, description: o.description, join_approval: o.approval,
    lead_id: o.leadId, created_by: o.actor, request_id: r.data.request_id ?? null, wa_group_id: waId, status: waId ? "active" : "creating",
  }).select("id").single();
  if (error) throw new Error(error.message);
  if (waId) await refreshGroup(db, data.id).catch(() => {});
  return data.id as string;
}

/** Pulls invite link + participant count from Meta. Groups still "creating" are matched by subject in the number's group list. */
export async function refreshGroup(db: Db, id: string) {
  const { data: g } = await db.from("lb_wa_groups").select("id,number_id,wa_group_id,subject,status").eq("id", id).single();
  if (!g) throw new Error("Group not found");
  const c = await creds(g.number_id);
  let waId = g.wa_group_id as string | null;
  if (!waId) {
    const list = await graph<{ data?: { groups?: { id: string; subject: string }[] } }>(c.token, `${c.endpoint}/groups?limit=200`);
    if (!list.ok) throw new Error(why(list.message));
    const { data: taken } = await db.from("lb_wa_groups").select("wa_group_id").eq("number_id", g.number_id).not("wa_group_id", "is", null);
    const used = new Set((taken ?? []).map((t) => t.wa_group_id));
    waId = list.data.data?.groups?.find((x) => x.subject === g.subject && !used.has(x.id))?.id ?? null;
    if (!waId) return false; // Meta has not finished creating it yet
  }
  const [info, link] = await Promise.all([
    graph<{ subject?: string; total_participant_count?: number; participants?: unknown[]; suspended?: boolean }>(c.token, `${waId}?fields=subject,description,participants,total_participant_count,suspended`),
    graph<{ invite_link?: string }>(c.token, `${waId}/invite_link`),
  ]);
  if (!info.ok) throw new Error(why(info.message));
  await db.from("lb_wa_groups").update({
    wa_group_id: waId, status: info.data.suspended ? "suspended" : "active", error: null,
    participants: info.data.total_participant_count ?? info.data.participants?.length ?? 0,
    ...(link.ok && link.data.invite_link ? { invite_link: link.data.invite_link } : {}),
  }).eq("id", g.id);
  return true;
}

export async function resetInviteLink(db: Db, id: string) {
  const { data: g } = await db.from("lb_wa_groups").select("number_id,wa_group_id").eq("id", id).single();
  if (!g?.wa_group_id) throw new Error("The group is not ready yet.");
  const c = await creds(g.number_id);
  const r = await graph<{ invite_link?: string }>(c.token, `${g.wa_group_id}/invite_link`, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp" }) });
  if (!r.ok) throw new Error(why(r.message));
  await db.from("lb_wa_groups").update({ invite_link: r.data.invite_link ?? null }).eq("id", id);
  if (!r.data.invite_link) await refreshGroup(db, id);
}

export async function deleteGroup(db: Db, id: string) {
  const { data: g } = await db.from("lb_wa_groups").select("number_id,wa_group_id").eq("id", id).single();
  if (!g) throw new Error("Group not found");
  if (g.wa_group_id) {
    const c = await creds(g.number_id);
    const r = await graph(c.token, g.wa_group_id, { method: "DELETE" });
    if (!r.ok && r.status !== 404) throw new Error(why(r.message));
  }
  await db.from("lb_wa_groups").update({ status: "deleted", invite_link: null }).eq("id", id);
}

export async function removeParticipant(db: Db, id: string, waId: string) {
  const { data: g } = await db.from("lb_wa_groups").select("number_id,wa_group_id").eq("id", id).single();
  if (!g?.wa_group_id) throw new Error("The group is not ready yet.");
  const c = await creds(g.number_id);
  const r = await graph(c.token, `${g.wa_group_id}/participants`, { method: "DELETE", body: JSON.stringify({ messaging_product: "whatsapp", participants: [{ user: waId }] }) });
  if (!r.ok) throw new Error(why(r.message));
  await refreshGroup(db, id).catch(() => {});
}

export async function participants(db: Db, id: string) {
  const { data: g } = await db.from("lb_wa_groups").select("number_id,wa_group_id").eq("id", id).single();
  if (!g?.wa_group_id) return [];
  const c = await creds(g.number_id);
  const r = await graph<{ participants?: { wa_id: string }[] }>(c.token, `${g.wa_group_id}?fields=participants`);
  return r.ok ? (r.data.participants ?? []).map((p) => p.wa_id) : [];
}

/** Sends text (and optionally an image/document by public link) to a group and logs it. */
export async function sendToGroup(db: Db, o: { groupId: string; companyId: string; actor: string; text: string; mediaUrl?: string | null; mediaType?: "image" | "document" | "video" }) {
  const { data: g } = await db.from("lb_wa_groups").select("id,number_id,wa_group_id,status").eq("id", o.groupId).eq("company_id", o.companyId).single();
  if (!g) throw new Error("Group not found");
  if (!g.wa_group_id || g.status !== "active") throw new Error("This group is not active yet. Tap Refresh after Meta finishes creating it.");
  const c = await creds(g.number_id);
  const kind = o.mediaUrl ? o.mediaType ?? "image" : "text";
  const payload = kind === "text"
    ? { type: "text", text: { preview_url: true, body: o.text } }
    : { type: kind, [kind]: { link: o.mediaUrl, ...(o.text ? { caption: o.text } : {}) } };
  const r = await graph<{ messages?: { id: string }[] }>(c.token, `${c.endpoint}/messages`, {
    method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "group", to: g.wa_group_id, ...payload }),
  });
  const now = new Date().toISOString();
  await db.from("lb_wa_group_messages").insert({
    company_id: o.companyId, group_id: g.id, direction: "out", wamid: r.ok ? r.data.messages?.[0]?.id ?? null : null, type: kind,
    body: o.text || null, media_url: o.mediaUrl ?? null, status: r.ok ? "sent" : "failed", error: r.ok ? null : r.message.slice(0, 300), sent_by: o.actor,
  });
  await db.from("lb_wa_groups").update({ last_message_at: now }).eq("id", g.id);
  if (!r.ok) throw new Error(why(r.message));
}

// ------------------------------------------------------------------ webhook
type GroupEvent = {
  type?: string; group_id?: string; request_id?: string; subject?: string; invite_link?: string;
  errors?: { message?: string; title?: string }[];
};

/** group_lifecycle_update / group_participants_update / group_settings_update / group_status_update. */
export async function applyGroupWebhook(db: Db, pnid: string | undefined, events: GroupEvent[]) {
  if (!pnid) return;
  const { data: num } = await db.from("lb_wa_numbers").select("id,company_id").eq("phone_number_id", pnid).maybeSingle();
  if (!num) return;
  for (const e of events) {
    if (!e.group_id && !e.request_id) continue;
    if (e.type === "group_create") {
      let q = db.from("lb_wa_groups").select("id").eq("number_id", num.id);
      q = e.request_id ? q.eq("request_id", e.request_id) : q.eq("status", "creating").eq("subject", e.subject ?? "");
      const { data: g } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!g) continue;
      const err = e.errors?.[0];
      await db.from("lb_wa_groups").update(err
        ? { status: "failed", error: (err.message ?? err.title ?? "Meta could not create the group").slice(0, 300) }
        : { status: "active", wa_group_id: e.group_id, invite_link: e.invite_link ?? null, error: null }).eq("id", g.id);
      continue;
    }
    if (!e.group_id) continue;
    const { data: g } = await db.from("lb_wa_groups").select("id").eq("wa_group_id", e.group_id).maybeSingle();
    if (!g) continue;
    if (e.type === "group_delete") await db.from("lb_wa_groups").update({ status: "deleted", invite_link: null }).eq("id", g.id);
    else if (e.type === "group_suspend") await db.from("lb_wa_groups").update({ status: "suspended" }).eq("id", g.id);
    else if (e.type === "group_suspend_cleared") await db.from("lb_wa_groups").update({ status: "active" }).eq("id", g.id);
    else if (e.type?.startsWith("group_participants")) await refreshGroup(db, g.id).catch(() => {});
    else if (e.type === "group_settings_update" && e.subject) await db.from("lb_wa_groups").update({ subject: e.subject.slice(0, 128) }).eq("id", g.id);
  }
}

/** A message someone wrote in a group: logged on the group, never turned into a lead or a 1-to-1 chat. */
export async function ingestGroupMessage(db: Db, pnid: string | undefined, m: { id: string; from: string; group_id: string; type: string; timestamp?: string }, body: string | null, name?: string) {
  const { data: g } = await db.from("lb_wa_groups").select("id,company_id").eq("wa_group_id", m.group_id).maybeSingle();
  if (!g) return; // a group this CRM does not know about
  const at = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
  await db.from("lb_wa_group_messages").upsert({
    company_id: g.company_id, group_id: g.id, direction: "in", wamid: m.id, from_wa: m.from, from_name: name ?? null,
    type: m.type, body, status: "received", created_at: at,
  }, { onConflict: "wamid", ignoreDuplicates: true });
  await db.from("lb_wa_groups").update({ last_message_at: at }).eq("id", g.id);
  void pnid;
}

export async function applyGroupStatus(db: Db, wamid: string, status: string, error?: string | null) {
  if (!["sent", "delivered", "read", "failed"].includes(status)) return;
  await db.from("lb_wa_group_messages").update({ status, ...(error ? { error: error.slice(0, 300) } : {}) }).eq("wamid", wamid).eq("direction", "out");
}

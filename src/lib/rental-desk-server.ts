import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "./supabase/server";
import { step, type Act, type DeskConfig, type Out, type State, type Stage, type Zone } from "./rental-desk";

type Db = ReturnType<typeof createAdminClient>;
type Inbound = { messageId: string; conversationId: string; companyId: string; body: string | null; type: string; replyId?: string | null };
type Conv = { id: string; number_id: string; customer_id: string };
type Row = State & { id: string; lead_id: string | null; last_in_at: string; updated_at: string; paid_at: string | null; benefits_sent: boolean | null };

const DAY = 86400000;
const MEDIA = ["image", "document"];
const TEXT = ["text", "button", "interactive"];

function stableId(...parts: string[]) {
  const h = createHash("sha256").update(parts.join(":")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function deskConfig(db: Db, companyId: string): Promise<(DeskConfig & { alert_phone: string | null }) | null> {
  const { data, error } = await db.from("lb_rental_desk").select("*").eq("company_id", companyId).maybeSingle();
  if (error || !data?.enabled) return null; // error: SQL not applied yet → desk simply off
  return {
    enabled: true, fee: data.fee, upi_id: data.upi_id ?? "", upi_name: data.upi_name ?? "", qr_url: data.qr_url ?? "",
    urgent_fee: data.urgent_fee ?? 500, single_min_budget: data.single_min_budget ?? 15000, channel_url: data.channel_url ?? "", instagram_url: data.instagram_url ?? "", help_phone: data.help_phone ?? "",
    min_followup_budget: data.min_followup_budget, followup_hours: data.followup_hours, max_followups: data.max_followups,
    max_followups_unreg: data.max_followups_unreg, zones: (Array.isArray(data.zones) ? data.zones : []) as Zone[], alert_phone: data.alert_phone,
  };
}

/** When an old run is over, a new message starts a fresh enquiry (history stays). */
function stale(r: Row) {
  const idle = Date.now() - new Date(r.last_in_at).getTime();
  if (["role", "form", "fee_offer", "details"].includes(r.stage)) return idle > 3 * DAY;
  if (r.stage === "done") return idle > 7 * DAY;
  if (r.stage === "closed") return idle > 30 * DAY;
  if (r.stage === "not_registered") return idle > 15 * DAY;
  return false;
}

/**
 * Rental desk (companies with lb_rental_desk.enabled only). Returns true when the desk handled the
 * message, so no other bot answers it. Never throws.
 */
export async function runRentalDesk(db: Db, ev: Inbound, conv: Conv, agentActive: () => Promise<boolean>): Promise<boolean> {
  const media = MEDIA.includes(ev.type);
  if (!media && !(ev.body && TEXT.includes(ev.type))) return false;
  const cfg = await deskConfig(db, ev.companyId);
  if (!cfg) return false;
  try {
    const { data: last } = await db.from("lb_rental_enquiries").select("*").eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    let row = last as Row | null;
    if (row && stale(row)) row = null;

    // A person is chatting in this enquiry right now: stay quiet, except for the steps only the desk handles.
    const deskOnly: Stage[] = ["awaiting_payment", "payment_review", "fu_ask", "fu_broker", "fu_rent", "fu_happy"];
    if (row && !deskOnly.includes(row.stage) && (await agentActive())) return true;

    const prev: State | null = row ? {
      stage: row.stage, role: row.role, answers: row.answers ?? {}, asking: row.asking, zone: row.zone, budget: row.budget,
      base_stage: row.base_stage, found_broker: row.found_broker, found_rent: row.found_rent, happy: row.happy, plan: row.plan ?? null,
      zones: row.zones ?? [], benefits: row.benefits_sent ?? false,
    } : null;
    const res = step(prev, { text: ev.body ?? "", replyId: ev.replyId, media }, cfg);

    // Save the run (new or restarted → new row).
    const restarted = !row;
    let id = row?.id;
    const patch = {
      stage: res.state.stage, role: res.state.role, answers: res.state.answers, asking: res.state.asking, zone: res.state.zone, budget: res.state.budget,
      base_stage: res.state.base_stage, found_broker: res.state.found_broker, found_rent: res.state.found_rent, happy: res.state.happy, plan: res.state.plan,
      zones: res.state.zones, benefits_sent: res.state.benefits,
      last_in_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      ...(res.state.stage === "closed" && prev?.stage !== "closed" ? { closed_at: new Date().toISOString(), next_followup_at: null } : {}),
      // Not registered: first follow-up a day later (the tick skips small budgets).
      ...(res.state.stage === "not_registered" && prev?.stage === "fee_offer" ? { next_followup_at: new Date(Date.now() + cfg.followup_hours * 3600e3).toISOString() } : {}),
      ...(res.state.stage === "awaiting_payment" ? { next_followup_at: null } : {}),
    };
    // One step per inbound message (webhook replays are no-ops): claim first, then write.
    const { data: claim, error: claimErr } = await db.from("lb_rental_log")
      .insert({ company_id: ev.companyId, enquiry_id: id ?? null, inbound_message_id: ev.messageId, kind: "step", detail: `${prev?.stage ?? "new"} → ${res.state.stage}` })
      .select("id").single();
    if (claimErr || !claim) return true;
    if (restarted) {
      const { data: lead } = await db.from("lb_leads").select("id").eq("company_id", ev.companyId).eq("customer_id", conv.customer_id).is("deleted_at", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const { data: ins, error } = await db.from("lb_rental_enquiries").insert({ company_id: ev.companyId, conversation_id: conv.id, customer_id: conv.customer_id, lead_id: lead?.id ?? null, ...patch })
        .select("id").single();
      if (error || !ins) throw new Error(`enquiry: ${error?.message}`);
      id = ins.id;
      await db.from("lb_rental_log").update({ enquiry_id: id }).eq("id", claim.id);
    } else {
      await db.from("lb_rental_enquiries").update(patch).eq("id", id!);
    }

    let i = 0;
    for (const o of res.out) await send(db, ev, o, i++);
    for (const a of res.acts) await act(db, ev, conv, id!, a, cfg).catch((e) => console.error("rental desk act", a.kind, (e as Error).message));
    return res.handled || res.out.length > 0;
  } catch (e) {
    console.error("rental desk failed:", (e as Error).message);
    return false;
  }
}

/** Queue one reply inside the 24h window (the customer just wrote). Drained in order by the outbox. */
export async function send(db: Db, ev: Pick<Inbound, "messageId" | "conversationId" | "companyId">, o: Out, i: number, purpose = "rental") {
  const row: Record<string, unknown> = {
    company_id: ev.companyId, conversation_id: ev.conversationId, direction: "out", status: "queued", automated: true,
    client_id: stableId(ev.messageId, purpose, String(i)), next_attempt_at: new Date(Date.now() + i).toISOString(),
  };
  let preview = "";
  if (o.kind === "text") Object.assign(row, { type: "text", body: (preview = o.body).slice(0, 4096) });
  else if (o.kind === "image") Object.assign(row, { type: "image", body: (preview = o.caption || "[image]"), payload: { link: o.url, ...(o.caption ? { caption: o.caption } : {}) } });
  else if (o.kind === "buttons") Object.assign(row, {
    type: "interactive", body: (preview = `${o.body}\n${o.buttons.map((b) => `[${b.title}]`).join(" ")}`),
    payload: { type: "button", body: { text: o.body }, action: { buttons: o.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) } },
  });
  else Object.assign(row, {
    type: "interactive", body: (preview = `${o.body}\n${o.rows.map((r) => `• ${r.title}`).join("\n")}`),
    payload: { type: "list", body: { text: o.body }, action: { button: o.button.slice(0, 20), sections: [{ title: "Options",
      rows: o.rows.map((r) => ({ id: `rd:${r.id}`, title: r.title.slice(0, 24), ...(r.description ? { description: r.description.slice(0, 72) } : {}) })) }] } },
  });
  const { error } = await db.from("lb_messages").insert(row);
  if (error && error.code !== "23505") throw new Error(`rental send: ${error.message}`);
  if (!error) await db.from("lb_conversations").update({ last_message_at: new Date().toISOString(), last_message_preview: preview.slice(0, 140), updated_at: new Date().toISOString() }).eq("id", ev.conversationId);
}

async function admins(db: Db, companyId: string) {
  const { data } = await db.from("lb_profiles").select("id,full_name").eq("company_id", companyId).eq("role", "company_admin").eq("is_active", true);
  return data ?? [];
}

async function act(db: Db, ev: Inbound, conv: Conv, enquiryId: string, a: Act, cfg: DeskConfig & { alert_phone: string | null }) {
  if (a.kind === "tag") {
    let { data: t } = await db.from("lb_tags").select("id").eq("company_id", ev.companyId).ilike("name", a.tag).limit(1).maybeSingle();
    if (!t) ({ data: t } = await db.from("lb_tags").insert({ company_id: ev.companyId, name: a.tag.slice(0, 40) }).select("id").single());
    if (t) await db.from("lb_conversation_tags").upsert({ conversation_id: conv.id, tag_id: t.id }, { ignoreDuplicates: true });
  } else if (a.kind === "status" || a.kind === "note") {
    let status: string | null = null;
    if (a.kind === "status") {
      const { data: s } = await db.from("lb_lead_statuses").select("id").eq("company_id", ev.companyId).eq("is_active", true).ilike("name", a.status).limit(1).maybeSingle();
      if (!s) return;
      status = s.id;
    }
    const { data: leadId, error } = await db.rpc("lb_flow_update_lead", { p_conversation: conv.id, p_status: status, p_priority: null, p_note: a.kind === "note" ? a.body : null });
    if (error) throw new Error(error.message);
    if (leadId) await db.from("lb_rental_enquiries").update({ lead_id: leadId }).eq("id", enquiryId).is("lead_id", null);
  } else if (a.kind === "screenshot") {
    await db.from("lb_rental_enquiries").update({ screenshot_message_id: ev.messageId, screenshot_at: new Date().toISOString() }).eq("id", enquiryId);
  } else if (a.kind === "notify_admins") {
    const { data: c } = await db.from("lb_customers").select("name,wa_profile_name,phone_e164").eq("id", conv.customer_id).single();
    const who = c?.name || c?.wa_profile_name || c?.phone_e164 || "Customer";
    const rows = (await admins(db, ev.companyId)).map((u) => ({
      company_id: ev.companyId, user_id: u.id, type: "rental_desk", title: `${a.title} · ${who}`.slice(0, 200), body: a.body, link: "/rental-desk",
      dedupe_key: `rental:${ev.messageId}:${u.id}`,
    }));
    for (const r of rows) await db.from("lb_notifications").insert(r); // a duplicate key (replay) just fails
  } else if (a.kind === "zone_assign") {
    // The lead goes to the agents of every zone of the area (copies for the 2nd, 3rd... agent). Bell + push via lb__assign.
    const { error } = await db.rpc("lb__rental_zone_assign", { p_id: enquiryId, p_actor: null, p_note: a.note });
    if (error) throw new Error(error.message);
  } else if (a.kind === "final_alert") {
    await queueFinalAlert(db, ev.companyId, enquiryId, cfg.alert_phone, `final:${ev.messageId}`);
  }
}

/** "Flat final" message: bell for admins + WhatsApp to the personal number (lb_alert_queue, kind rental_final). */
export async function queueFinalAlert(db: Db, companyId: string, enquiryId: string, phone: string | null, key: string) {
  const { data: e } = await db.from("lb_rental_enquiries")
    .select("zone,budget,found_broker,found_rent,happy,lead_id,answers,customer:lb_customers(name,wa_profile_name,phone_e164),assigned:lb_profiles!lb_rental_enquiries_assigned_to_fkey(full_name)")
    .eq("id", enquiryId).single();
  if (!e) return;
  const c = e.customer as unknown as { name: string | null; wa_profile_name: string | null; phone_e164: string } | null;
  const asg = e.assigned as unknown as { full_name: string } | null;
  const title = "🏠 Flat final (LivoraRent)";
  const body = [
    `${c?.name || c?.wa_profile_name || "Customer"} ${c?.phone_e164 ?? ""}`.trim(),
    `Flat diya: ${e.found_broker ?? "-"}`, `Rent: ${e.found_rent ?? "-"}`, `Happy: ${e.happy ?? "-"}`,
    e.zone ? `Zone ${e.zone}${asg ? ` (${asg.full_name})` : ""}` : null,
  ].filter(Boolean).join(" · ");
  const link = e.lead_id ? `/leads/${e.lead_id}` : "/rental-desk";
  const people = await admins(db, companyId);
  for (const u of people) await db.from("lb_notifications").insert({ company_id: companyId, user_id: u.id, type: "rental_desk", title, body, link, dedupe_key: `${key}:${u.id}` });
  // WhatsApp to the personal number: one alert row (user = first admin, only for the queue's bookkeeping).
  if (phone && people[0]) {
    await db.from("lb_alert_queue").insert({ company_id: companyId, user_id: people[0].id, channel: "whatsapp", kind: "rental_final", title, body, link, dedupe_key: `wa:${key}` });
  }
}

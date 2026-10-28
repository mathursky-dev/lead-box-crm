import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "./supabase/server";
import { norm } from "./wa";
import { advance, normalizeGraph, triggerHit, type Effect, type FlowGraph, type FlowTrigger, type Step } from "./wa-flow";

type Db = ReturnType<typeof createAdminClient>;
type Inbound = { messageId: string; conversationId: string; companyId: string; body: string | null; type: string; replyId?: string | null };
type Conv = { id: string; number_id: string; customer_id: string };
type FlowRow = FlowTrigger & { id: string; name: string; graph: unknown; priority: number };
type Session = { id: string; flow_id: string; node_id: string | null; vars: Record<string, string>; retries: number; expires_at: string };

function stableId(...parts: string[]) {
  const h = createHash("sha256").update(parts.join(":")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Visual chatbot flows. Runs before keyword bots: continues the chat's waiting flow, or starts the
 * first active flow whose trigger matches. Returns true when a flow handled the message.
 */
export async function runFlows(db: Db, ev: Inbound, conv: Conv): Promise<boolean> {
  const text = ev.body ?? "";
  const [{ data: tagRows }, { data: cust }] = await Promise.all([
    db.from("lb_conversation_tags").select("tag:lb_tags(name)").eq("conversation_id", conv.id),
    db.from("lb_customers").select("name,wa_profile_name,phone_e164,email").eq("id", conv.customer_id).single(),
  ]);
  const tags = (tagRows ?? []).map((r) => (r.tag as unknown as { name: string } | null)?.name).filter(Boolean) as string[];
  const base = { name: cust?.name || cust?.wa_profile_name || "", phone: cust?.phone_e164 ?? "", email: cust?.email ?? "" };

  // 1) A flow is waiting for this chat's answer.
  const { data: live } = await db.from("lb_wa_flow_sessions").select("id,flow_id,node_id,vars,retries,expires_at")
    .eq("conversation_id", conv.id).eq("status", "waiting").maybeSingle();
  let session = live as Session | null;
  if (session && new Date(session.expires_at) < new Date()) {
    await db.from("lb_wa_flow_sessions").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", session.id);
    session = null;
  }
  if (session) {
    const { data: f } = await db.from("lb_wa_flows").select("id,name,graph,is_active").eq("id", session.flow_id).maybeSingle();
    if (!f?.is_active) {
      await db.from("lb_wa_flow_sessions").update({ status: "stopped", updated_at: new Date().toISOString() }).eq("id", session.id);
    } else {
      const g = normalizeGraph(f.graph);
      if (!(await claim(db, ev, f.id, session.id))) return true;
      const t = norm(text);
      if (g.settings.stop_keyword && t === norm(g.settings.stop_keyword)) {
        await db.from("lb_wa_flow_sessions").update({ status: "stopped", updated_at: new Date().toISOString() }).eq("id", session.id);
        return true;
      }
      if (g.settings.restart_keyword && t === norm(g.settings.restart_keyword)) {
        await db.from("lb_wa_flow_sessions").update({ status: "stopped", updated_at: new Date().toISOString() }).eq("id", session.id);
        await startSession(db, ev, conv, { id: f.id, name: f.name }, g, { ...base }, tags);
        return true;
      }
      const step = advance(g, session.node_id ?? "", { vars: { ...base, ...session.vars }, tags }, { text, replyId: ev.replyId }, session.retries);
      await applyStep(db, ev, conv, f.id, f.name, session.id, step, g);
      return true;
    }
  }

  // 2) Start a new flow.
  const { data: flows } = await db.from("lb_wa_flows").select("id,name,graph,priority,trigger_type,keywords,match_type,number_id,tag_names")
    .eq("company_id", ev.companyId).eq("is_active", true).neq("trigger_type", "manual").order("priority").order("created_at");
  if (!flows?.length) return false;
  const { count: inbound } = await db.from("lb_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id).eq("direction", "in");
  const hit = (flows as FlowRow[]).find((f) => triggerHit(f, text, { numberId: conv.number_id, tags, firstMessage: (inbound ?? 0) <= 1 }));
  if (!hit) return false;
  const g = normalizeGraph(hit.graph);
  if (!(await claim(db, ev, hit.id, null))) return true;
  await startSession(db, ev, conv, hit, g, base, tags);
  return true;
}

/** One flow run per inbound message, even when Meta redelivers the webhook. */
async function claim(db: Db, ev: Inbound, flowId: string, sessionId: string | null) {
  const { error } = await db.from("lb_wa_flow_events").insert({ company_id: ev.companyId, flow_id: flowId, session_id: sessionId, kind: "inbound", inbound_message_id: ev.messageId });
  return !error;
}

async function startSession(db: Db, ev: Inbound, conv: Conv, f: { id: string; name: string }, g: FlowGraph, vars: Record<string, string>, tags: string[]) {
  const start = g.nodes.find((n) => n.type === "start")!;
  const { data: s, error } = await db.from("lb_wa_flow_sessions").insert({
    company_id: ev.companyId, flow_id: f.id, conversation_id: conv.id, node_id: start.id, vars, status: "waiting",
    expires_at: new Date(Date.now() + g.settings.timeout_hours * 3600000).toISOString(),
  }).select("id").single();
  if (error || !s) return; // another delivery started one a moment ago
  const { data: fr } = await db.from("lb_wa_flows").select("run_count").eq("id", f.id).single();
  await db.from("lb_wa_flows").update({ run_count: (fr?.run_count ?? 0) + 1 }).eq("id", f.id);
  await applyStep(db, ev, conv, f.id, f.name, s.id, advance(g, start.id, { vars, tags }), g);
}

async function applyStep(db: Db, ev: Inbound, conv: Conv, flowId: string, flowName: string, sessionId: string, step: Step, g: FlowGraph) {
  let handoff = false;
  let i = 0;
  for (const e of step.effects) {
    try {
      if (e.kind === "send") await queue(db, ev, e, i++);
      else if (e.kind === "tag") await tag(db, ev.companyId, conv.id, e.tag, e.op);
      else if (e.kind === "field") await db.from("lb_customers").update({ [e.field]: e.value.slice(0, 200), updated_at: new Date().toISOString() }).eq("id", conv.customer_id);
      else if (e.kind === "assign") {
        handoff = true;
        await db.from("lb_conversations").update({ status: "open", updated_at: new Date().toISOString(), ...(e.user_id ? { assignee_id: e.user_id } : {}) }).eq("id", conv.id);
      } else if (e.kind === "webhook") {
        await fetch(e.url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(5000),
          body: JSON.stringify({ flow: flowName, flow_id: flowId, conversation_id: conv.id, variables: e.vars }) }).catch(() => {});
      }
    } catch (err) {
      await db.from("lb_wa_flow_events").insert({ company_id: ev.companyId, flow_id: flowId, session_id: sessionId, node_id: e.node, kind: "error", detail: (err as Error).message.slice(0, 300) });
    }
  }
  const events = step.path.map((node_id) => ({ company_id: ev.companyId, flow_id: flowId, session_id: sessionId, node_id, kind: "enter" }));
  if (step.invalid) events.push({ company_id: ev.companyId, flow_id: flowId, session_id: sessionId, node_id: step.node ?? "", kind: "invalid" });
  if (step.status === "done") events.push({ company_id: ev.companyId, flow_id: flowId, session_id: sessionId, node_id: "", kind: handoff ? "handoff" : "done" });
  if (events.length) await db.from("lb_wa_flow_events").insert(events);
  await db.from("lb_wa_flow_sessions").update({
    node_id: step.node, vars: step.vars, retries: step.retries, updated_at: new Date().toISOString(),
    status: step.status === "waiting" ? "waiting" : handoff ? "handoff" : "done",
    ...(step.status === "waiting" ? { expires_at: new Date(Date.now() + g.settings.timeout_hours * 3600000).toISOString() } : {}),
  }).eq("id", sessionId);
}

/** Queue a send inside the 24h window (the customer just wrote). Drained in order by the outbox. */
async function queue(db: Db, ev: Inbound, e: Extract<Effect, { kind: "send" }>, i: number) {
  const row: Record<string, unknown> = {
    company_id: ev.companyId, conversation_id: ev.conversationId, direction: "out", type: e.type, body: e.body.slice(0, 4096) || null,
    client_id: stableId(ev.messageId, "flow", e.node, String(i)), status: "queued", automated: true,
    next_attempt_at: new Date(Date.now() + i).toISOString(),
  };
  if (e.type === "template") Object.assign(row, { template_name: e.template_name, template_language: e.template_language, template_params: e.params });
  else if ("payload" in e) row.payload = e.payload;
  if (e.type === "text" && !e.body.trim()) return;
  const { error } = await db.from("lb_messages").insert(row);
  if (error && error.code !== "23505") throw new Error(`flow send: ${error.message}`);
  if (!error) {
    await db.from("lb_conversations").update({ last_message_at: new Date().toISOString(), last_message_preview: e.body.slice(0, 140), updated_at: new Date().toISOString() }).eq("id", ev.conversationId);
  }
}

async function tag(db: Db, companyId: string, conversationId: string, name: string, op: "add" | "remove") {
  let { data: t } = await db.from("lb_tags").select("id").eq("company_id", companyId).ilike("name", name.trim().replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle();
  if (!t && op === "add") ({ data: t } = await db.from("lb_tags").insert({ company_id: companyId, name: name.trim().slice(0, 40) }).select("id").single());
  if (!t) return;
  if (op === "add") await db.from("lb_conversation_tags").upsert({ conversation_id: conversationId, tag_id: t.id }, { ignoreDuplicates: true });
  else await db.from("lb_conversation_tags").delete().eq("conversation_id", conversationId).eq("tag_id", t.id);
}

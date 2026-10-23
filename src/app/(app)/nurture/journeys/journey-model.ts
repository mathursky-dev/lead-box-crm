// Shared journey vocabulary for the builder, flow view and preview.

export type Step = { type: string; config: Record<string, unknown>; next_step: number | null };
export type JourneyDraft = {
  id?: string; name: string; description: string; trigger_type: string; trigger_config: Record<string, string>; priority: number; number_id: string;
  pause_on_reply: boolean; stop_on_purchase: boolean; stop_on_lost: boolean; stop_on_manual_takeover: boolean; stop_on_payment: boolean; stop_on_complaint: boolean;
  steps: Step[];
};

export const TRIGGERS: [string, string][] = [
  ["lead_created", "A new lead is created"], ["status_entered", "Lead enters a status"], ["inbound_message", "Customer sends a message"],
  ["buying_signal", "Buying signal detected"], ["sla_breach", "Reply SLA breached"], ["payment_pending", "Payment becomes pending"],
  ["won", "Lead converted (order placed)"], ["days_after_won", "Days after conversion (reorder)"], ["complaint", "Complaint raised"],
  ["segment", "Lead matches a segment"], ["manual", "Manual enrolment only"],
];

export const STEP_TYPES: [string, string, string][] = [
  ["message", "Send template", "✉"], ["wait_reply", "Wait for reply", "⏳"], ["delay", "Wait", "⏱"], ["branch", "If / else", "◇"],
  ["task", "Agent task", "☑"], ["assign", "Assign owner", "👤"], ["notify", "Notify team", "🔔"], ["set_status", "Set status", "◉"],
  ["tag", "Add tag", "#"], ["ai_summary", "AI summary", "✦"], ["end", "End", "■"],
];

export const CONDITIONS: [string, string][] = [
  ["replied", "Customer replied since enrolment"], ["buying_signal", "Buying signal since enrolment"], ["paid", "Payment is paid"],
  ["purchased", "Customer has purchased"], ["opted_in", "Customer opted in"], ["status_in", "Lead status category is…"],
  ["product", "Lead product is…"], ["priority_high", "Priority is high/urgent"], ["owner_available", "Owner is available now"],
];

export const CATS = ["new", "assigned", "contacted", "interested", "follow_up", "scheduled", "won", "lost", "invalid"];

const base = { description: "", priority: 100, number_id: "", pause_on_reply: true, stop_on_purchase: true, stop_on_lost: true,
  stop_on_manual_takeover: true, stop_on_payment: false, stop_on_complaint: true };
const st = (type: string, config: Record<string, unknown> = {}, next_step: number | null = null): Step => ({ type, config, next_step });

/** Starter journeys. Message steps need an approved template chosen before publishing. */
export const TEMPLATES: { key: string; title: string; blurb: string; draft: JourneyDraft }[] = [
  { key: "smart_allocation", title: "Smart allocation & first touch", blurb: "Assign new leads to an available agent, notify them, and chase if the customer goes quiet.",
    draft: { ...base, name: "New lead: smart allocation", trigger_type: "lead_created", trigger_config: {}, priority: 20, steps: [
      st("assign", { mode: "smart" }), st("notify", { target: "owner", title: "New lead assigned — reply within 15 minutes" }),
      st("task", { title: "First call / WhatsApp to the new lead", action_type: "call", due_in_hours: 1 }),
      st("wait_reply", { minutes: 1440, then_step: 6, else_step: 5 }), st("message", {}), st("end")] } },
  { key: "sla", title: "Reply SLA escalation", blurb: "When a customer waits too long: route to the backup if the owner is away and alert team leaders.",
    draft: { ...base, name: "Reply SLA escalation", trigger_type: "sla_breach", trigger_config: {}, priority: 10, pause_on_reply: false, stop_on_manual_takeover: true, steps: [
      st("branch", { condition: "owner_available", then_step: 3, else_step: 2 }), st("assign", { mode: "smart" }),
      st("notify", { target: "team_leaders", title: "Customer waiting for a reply" }), st("task", { title: "Reply to the waiting customer now", action_type: "whatsapp", due_in_hours: 0 }), st("end")] } },
  { key: "followups", title: "Follow-up tasks", blurb: "Interested leads get a scheduled call, then a reminder template if they don't reply.",
    draft: { ...base, name: "Interested: follow-up", trigger_type: "status_entered", trigger_config: { category: "interested" }, priority: 50, steps: [
      st("task", { title: "Call to discuss requirement", action_type: "call", due_in_hours: 4 }), st("delay", { minutes: 1440 }),
      st("branch", { condition: "replied", then_step: 6, else_step: 4 }), st("message", {}), st("task", { title: "Second follow-up call", action_type: "call", due_in_hours: 24 }), st("end")] } },
  { key: "payment", title: "Quotation / payment recovery", blurb: "Payment pending: remind after a day, wait for reply, then hand to the owner. Stops on payment.",
    draft: { ...base, name: "Payment recovery", trigger_type: "payment_pending", trigger_config: {}, priority: 15, stop_on_payment: true, steps: [
      st("delay", { minutes: 1440 }), st("message", {}), st("wait_reply", { minutes: 2880, then_step: 5, else_step: 4 }),
      st("task", { title: "Call about pending payment", action_type: "payment", due_in_hours: 4 }), st("end")] } },
  { key: "order", title: "Order notification", blurb: "Send an order confirmation (utility template) when a lead converts.",
    draft: { ...base, name: "Order confirmation", trigger_type: "won", trigger_config: {}, priority: 5, stop_on_purchase: false, pause_on_reply: false, steps: [
      st("message", {}), st("end")] } },
  { key: "support", title: "Support routing", blurb: "On a complaint: notify team leaders, make sure an available agent owns it and create an urgent task.",
    draft: { ...base, name: "Complaint support routing", trigger_type: "complaint", trigger_config: {}, priority: 1, stop_on_complaint: false, pause_on_reply: false, steps: [
      st("notify", { target: "team_leaders", title: "Complaint needs attention" }), st("assign", { mode: "smart" }),
      st("task", { title: "Resolve the customer's complaint", action_type: "call", due_in_hours: 2 }), st("ai_summary"), st("end")] } },
  { key: "reorder", title: "Reorder reminder", blurb: "30 days after a purchase, send a reorder template to opted-in customers.",
    draft: { ...base, name: "Reorder after 30 days", trigger_type: "days_after_won", trigger_config: { days: "30" }, priority: 80, stop_on_purchase: false, steps: [
      st("message", {}), st("wait_reply", { minutes: 4320, then_step: 4, else_step: 3 }), st("end"), st("task", { title: "Customer replied to reorder reminder", action_type: "whatsapp", due_in_hours: 2 }), st("end")] } },
  { key: "reactivation", title: "Consent-based reactivation", blurb: "Re-engage opted-in customers inactive for 30+ days (use a segment with inactive days and consent).",
    draft: { ...base, name: "Reactivation", trigger_type: "segment", trigger_config: {}, priority: 90, steps: [
      st("message", {}), st("wait_reply", { minutes: 4320, then_step: 4, else_step: 3 }), st("end"),
      st("assign", { mode: "smart" }), st("task", { title: "Re-engaged customer replied", action_type: "whatsapp", due_in_hours: 1 }), st("end")] } },
  { key: "signal", title: "Buying-signal fast track", blurb: "A buying signal raises priority attention: notify the owner and create an immediate task.",
    draft: { ...base, name: "Buying signal fast track", trigger_type: "buying_signal", trigger_config: {}, priority: 12, pause_on_reply: false, steps: [
      st("notify", { target: "owner", title: "Buying signal — respond now" }), st("task", { title: "Customer showed buying intent — call now", action_type: "call", due_in_hours: 0 }), st("end")] } },
];

/** One-line human description of a step, used by the flow view and preview. */
export function describeStep(s: Step, names: { templates?: boolean; users?: Map<string, string>; tags?: Map<string, string> } = {}) {
  const c = s.config as Record<string, string>;
  switch (s.type) {
    case "message": return c.template_name ? `Send template “${c.template_name}” (${c.template_language})${c.offer_id ? " with offer" : ""}` : "Send template — choose one";
    case "wait_reply": return `Wait up to ${fmtMin(Number(c.minutes ?? 1440))} for a reply`;
    case "delay": return `Wait ${fmtMin(Number(c.minutes ?? 60))}`;
    case "branch": return `If ${CONDITIONS.find(([k]) => k === c.condition)?.[1] ?? "…"}${c.condition === "status_in" ? ` (${(s.config.values as string[] | undefined)?.join(", ") ?? ""})` : ""}`;
    case "task": return `Task for owner: ${c.title ?? "…"} (due in ${c.due_in_hours ?? 4}h)`;
    case "assign": return c.mode === "user" ? `Assign to ${names.users?.get(c.user_id) ?? "a user"}` : "Smart assign (available agent / backup)";
    case "notify": return `Notify ${({ owner: "owner", team_leaders: "team leaders", admins: "admins", user: names.users?.get(c.user_id) ?? "user" } as Record<string, string>)[c.target] ?? "…"}: ${c.title ?? ""}`;
    case "set_status": return `Set status category → ${c.category ?? "…"}`;
    case "tag": return `Add tag ${names.tags?.get(c.tag_id) ?? ""}`;
    case "ai_summary": return "Generate AI summary for the owner";
    case "end": return "End";
    default: return s.type;
  }
}
export const fmtMin = (m: number) => (m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? "" : "s"}` : m % 60 === 0 ? `${m / 60} h` : `${m} min`);

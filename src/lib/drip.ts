// Drip campaigns: a simple "Day 0 / Day 1 / Day 3" view over nurture journeys.
// A drip is stored as an ordinary journey (trigger_config.drip = "true"), so the
// existing runner handles consent, quiet hours, caps, reply pause and stop rules.
import type { JourneyDraft, Step } from "@/app/(app)/nurture/journeys/journey-model";

export type DripMessage = { day: number; template_name: string; template_language: string; params: string[] };
export type DripDraft = {
  id?: string;
  name: string;
  trigger: "lead_created" | "status";
  status_id: string;          // for trigger "status"
  category: string;           // category of that status (journeys need it)
  source_id: string;          // optional filter
  number_id: string;
  stop_on_status_change: boolean;
  pause_on_reply: boolean;
  final_task: string;         // optional task for the owner after the last message
  messages: DripMessage[];
};

export const MAX_DRIP_MESSAGES = 15;
export const MAX_DRIP_DAY = 365;

export const blankDrip = (): DripDraft => ({
  name: "", trigger: "status", status_id: "", category: "", source_id: "", number_id: "", stop_on_status_change: true, pause_on_reply: true,
  final_task: "Drip finished: call the customer",
  messages: [{ day: 0, template_name: "", template_language: "", params: [] }, { day: 1, template_name: "", template_language: "", params: [] }, { day: 3, template_name: "", template_language: "", params: [] }],
});

/** Problems that block saving, in plain words. */
export function dripIssues(d: DripDraft): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push("Give the drip a name.");
  if (d.trigger === "status" && (!d.status_id || !d.category)) out.push("Choose the lead status that starts the drip.");
  if (!d.messages.length) out.push("Add at least one message.");
  if (d.messages.length > MAX_DRIP_MESSAGES) out.push(`At most ${MAX_DRIP_MESSAGES} messages.`);
  let prev = -1;
  d.messages.forEach((m, i) => {
    if (!m.template_name || !m.template_language) out.push(`Message ${i + 1}: choose an approved template.`);
    if (!Number.isInteger(m.day) || m.day < 0 || m.day > MAX_DRIP_DAY) out.push(`Message ${i + 1}: day must be 0 to ${MAX_DRIP_DAY}.`);
    else if (m.day < prev) out.push(`Message ${i + 1}: days must go up (Day ${m.day} comes after Day ${prev}).`);
    prev = Math.max(prev, m.day);
  });
  return out;
}

/** Journey payload for lb_save_journey. */
export function dripToJourney(d: DripDraft): JourneyDraft {
  const steps: Step[] = [];
  let prev = 0;
  for (const m of d.messages) {
    const gap = (m.day - prev) * 1440;
    if (gap > 0) steps.push({ type: "delay", config: { minutes: gap }, next_step: null });
    steps.push({ type: "message", config: { template_name: m.template_name, template_language: m.template_language, params: m.params.slice(0, 20) }, next_step: null });
    prev = m.day;
  }
  if (d.final_task.trim()) steps.push({ type: "task", config: { title: d.final_task.trim().slice(0, 200), action_type: "call", due_in_hours: 4 }, next_step: null });
  steps.push({ type: "end", config: {}, next_step: null });
  const cfg: Record<string, string> = { drip: "true" };
  if (d.trigger === "status") { cfg.category = d.category; cfg.status_id = d.status_id; if (d.stop_on_status_change) cfg.stop_on_status_change = "true"; }
  if (d.source_id) cfg.source_id = d.source_id;
  return {
    ...(d.id ? { id: d.id } : {}),
    name: d.name.trim(), description: "Drip campaign", trigger_type: d.trigger === "status" ? "status_entered" : "lead_created", trigger_config: cfg,
    priority: 60, number_id: d.number_id, pause_on_reply: d.pause_on_reply, stop_on_purchase: true, stop_on_lost: true, stop_on_manual_takeover: false,
    stop_on_payment: false, stop_on_complaint: true, steps,
  };
}

/** Rebuild the simple view from stored steps. Returns null when the journey was edited into something a drip can't show. */
export function journeyToDrip(j: { id: string; name: string; trigger_type: string; trigger_config: Record<string, string> | null; number_id: string | null; pause_on_reply: boolean },
  steps: { type: string; config: Record<string, unknown> }[]): DripDraft | null {
  const c = j.trigger_config ?? {};
  if (c.drip !== "true" || !["status_entered", "lead_created"].includes(j.trigger_type)) return null;
  const messages: DripMessage[] = [];
  let day = 0, task = "";
  for (const s of steps) {
    if (s.type === "delay") day += Math.round(Number(s.config.minutes ?? 0) / 1440);
    else if (s.type === "message") messages.push({ day, template_name: String(s.config.template_name ?? ""), template_language: String(s.config.template_language ?? ""), params: (s.config.params as string[] | undefined) ?? [] });
    else if (s.type === "task") task = String(s.config.title ?? "");
    else if (s.type !== "end") return null;
  }
  return {
    id: j.id, name: j.name, trigger: j.trigger_type === "status_entered" ? "status" : "lead_created", status_id: c.status_id ?? "", category: c.category ?? "",
    source_id: c.source_id ?? "", number_id: j.number_id ?? "", stop_on_status_change: c.stop_on_status_change === "true", pause_on_reply: j.pause_on_reply,
    final_task: task, messages,
  };
}

export const dripDays = (steps: { type: string; config: Record<string, unknown> }[]) => {
  const days: number[] = [];
  let day = 0;
  for (const s of steps) {
    if (s.type === "delay") day += Math.round(Number(s.config.minutes ?? 0) / 1440);
    if (s.type === "message") days.push(day);
  }
  return days;
};

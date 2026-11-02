import type { Refs } from "./data";

// Turns raw lb_audit_log rows into readable lines for the Audit log page and its Excel export.

export type AuditRow = { id: string; action: string; entity: string | null; entity_id: string | null; data: Record<string, unknown> | null; created_at: string; actor: { full_name: string } | null };
export type Change = { field: string; from: string; to: string };

const FIELD: Record<string, string> = {
  status_id: "Status", sub_status_id: "Sub-status", owner_id: "Owner", priority: "Priority", source_id: "Source", product_id: "Product",
  team_id: "Team", branch_id: "Branch", department_id: "Department", number_id: "WhatsApp number", expected_value: "Expected value",
  won_value: "Won value", lost_reason: "Lost reason", notes: "Notes", remark: "Remark", custom: "Custom fields", payment_status: "Payment status",
  payment_due_amount: "Payment due", deleted_at: "Deleted", merged_into: "Merged into", customer_id: "Customer", name: "Name",
  phone_e164: "Phone", email: "Email", location: "City / location", role: "Role", full_name: "Name", phone: "Phone", permissions: "Permissions",
  is_active: "Active", accepts_auto_allocation: "Gets auto-allocated leads", allocation_limit: "Allocation limit", username: "Username",
};

const VERB: Record<string, string> = {
  "lead.status": "Changed lead status", "lead.assign": "Reassigned lead", "lead.update": "Edited lead", "lead.delete": "Deleted lead",
  "lead.restore": "Restored lead", "lead.merge": "Merged lead", "lead.delete_permanent": "Permanently deleted lead",
  "customer.update": "Edited customer", "user.change": "Changed user", "user.create": "Added user", "user.update": "Updated user",
  "user.password_set": "Set a user's password", "leads.assign": "Assigned leads", "leads.import": "Imported leads", "leads.export": "Exported leads",
  "leads.delete": "Deleted leads", "leads.restore": "Restored leads", "leads.merge": "Merged duplicate leads", "contacts.export": "Exported contacts",
  "message.retry": "Retried a message",
};
const OBJ: Record<string, string> = {
  status: "status", sub_status: "sub-status", source: "source", tag: "tag", department: "department", custom_field: "custom field", form: "form",
  lost_reason: "lost reason", product: "product", quick_reply: "quick reply", rule: "allocation rule", wa_bot: "chatbot", wa_flow: "chatbot flow",
  wa_number: "WhatsApp number", wa_template: "template", journey: "journey", campaign: "campaign", segment: "segment", offer: "offer",
  knowledge: "AI knowledge", org: "organisation", store: "store", settings: "settings",
};
const DO: Record<string, string> = { create: "Added", update: "Updated", delete: "Deleted", save: "Saved", save_draft: "Saved draft of", publish: "Published", reorder: "Reordered" };

export function actionLabel(a: string) {
  if (VERB[a]) return VERB[a];
  const [obj, op] = a.split(".");
  if (OBJ[obj] && DO[op]) return `${DO[op]} ${OBJ[obj]}`;
  if (OBJ[obj]) return `${OBJ[obj].charAt(0).toUpperCase() + OBJ[obj].slice(1)}: ${op?.replace(/_/g, " ")}`;
  return a.replace(/[._]/g, " ");
}

export function nameMaps(refs: Refs) {
  const m = (l: { id: string; name?: string; full_name?: string; label?: string }[]) => new Map(l.map((x) => [x.id, x.name ?? x.full_name ?? x.label ?? ""]));
  return {
    status_id: m(refs.statuses), sub_status_id: m(refs.subStatuses), owner_id: m(refs.users), source_id: m(refs.sources), product_id: m(refs.products),
    team_id: m(refs.teams), branch_id: m(refs.branches), department_id: m(refs.departments), number_id: m(refs.numbers),
  } as Record<string, Map<string, string>>;
}

const show = (field: string, v: unknown, names: Record<string, Map<string, string>>): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "deleted_at") return "Yes";
  if (names[field] && typeof v === "string") return names[field].get(v) ?? "(removed)";
  if (field === "merged_into" || field === "customer_id") return "another record";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${x ?? "—"}`).join("; ") || "—";
  const s = String(v);
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
};

export function changesOf(row: AuditRow, names: Record<string, Map<string, string>>): Change[] {
  const ch = row.data?.changes as Record<string, [unknown, unknown]> | undefined;
  if (!ch || typeof ch !== "object") return [];
  return Object.entries(ch).map(([k, [a, b]]) => ({ field: FIELD[k] ?? k, from: show(k, a, names), to: show(k, b, names) }));
}

/** Short "what" text: LB-123, a user's name, or the raw details for older admin entries. */
export function subjectOf(row: AuditRow, names: Record<string, Map<string, string>>): string {
  const d = row.data ?? {};
  if (row.entity === "lead" && d.lead_no) return `LB-${d.lead_no}`;
  if (row.entity === "user") return String(d.name ?? names.owner_id.get(row.entity_id ?? "") ?? "user");
  if (row.entity === "customer") return "Customer";
  if (d.changes) return "";
  const pick = ["name", "label", "title", "count", "reason"].filter((k) => d[k] !== undefined && d[k] !== null).map((k) => `${d[k]}`);
  if (pick.length) return pick.join(" · ");
  const raw = JSON.stringify(d);
  return raw === "{}" ? "" : raw.length > 140 ? raw.slice(0, 137) + "…" : raw;
}

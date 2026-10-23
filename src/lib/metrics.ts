import { rangeFor, type Preset } from "./dates";

/** Every metric shown on a dashboard; label + plain-language definition. */
export const METRICS: Record<string, { label: string; def: string; kind: "current" | "period" }> = {
  total_leads: { label: "Total Leads", kind: "period", def: "Unique leads created in the selected period (transfers never add to this). Credited to the current owner." },
  unassigned: { label: "Unassigned", kind: "current", def: "Open leads with no owner right now (current workload, ignores the date range)." },
  allocated: { label: "Allocated", kind: "period", def: "Unique leads that received an assignment during the period (new allocations + transfers in), counted once per lead." },
  current_assigned: { label: "Current Assigned", kind: "current", def: "Open leads (not Won/Lost/Invalid) owned right now." },
  opening_assigned: { label: "Opening Assigned", kind: "period", def: "Leads owned at the start of the period (from assignment history) that were open at that moment." },
  new_allocations: { label: "New Allocations", kind: "period", def: "Unique leads assigned during the period from the unassigned queue (first allocation or re-allocation from unassigned)." },
  transfers_in: { label: "Transfers In", kind: "period", def: "Unique leads moved to the user from another user during the period." },
  transfers_out: { label: "Transfers Out", kind: "period", def: "Unique leads moved away from the user to another user during the period." },
  untouched: { label: "Untouched", kind: "current", def: "Currently owned open leads with no recorded action by the owner since they were assigned." },
  worked: { label: "Worked", kind: "period", def: "Unique leads with at least one recorded action (status change, note, call, WhatsApp reply, follow-up, field edit) in the period — opening a lead does not count. Credited to the user who acted." },
  follow_up: { label: "Follow-up", kind: "current", def: "Leads currently in a Follow-up status category." },
  followups_due: { label: "Follow-ups Due", kind: "current", def: "Leads with a pending follow-up due today (IST)." },
  overdue: { label: "Overdue", kind: "current", def: "Leads with a pending follow-up due before today (IST)." },
  converted: { label: "Converted", kind: "period", def: "Leads converted (Won) during the period, by conversion date, credited to the owner at the time of conversion." },
  lost: { label: "Lost", kind: "period", def: "Leads moved to Lost during the period and still Lost, credited to the owner at that time." },
  invalid: { label: "Invalid", kind: "period", def: "Leads moved to Invalid during the period and still Invalid, credited to the owner at that time." },
  cohort_allocated: { label: "Cohort: first allocated", kind: "period", def: "Unique leads whose FIRST allocation happened in the period, credited to the original allocation owner." },
  cohort_won: { label: "Cohort: now won", kind: "period", def: "Of the cohort above, leads that are Won today (whenever they converted)." },
};

export const COHORT_RATE_DEF =
  "Cohort conversion rate = unique leads first allocated in the selected period that are now Won ÷ unique leads first allocated in that period × 100. It is different from period conversions, which count conversions by conversion date.";

export const FILTER_KEYS = ["preset", "from", "to", "branch_id", "department_id", "team_id", "user_id", "number_id", "product_id", "source_id", "status_id"] as const;
export type FilterParams = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

/** Convert URL filter params to the RPC payload (IST date range → UTC instants). */
export function toRpcFilters(sp: FilterParams) {
  const preset = (sp.preset as Preset) || "today";
  const { from, to } = rangeFor(preset, sp.from, sp.to);
  const p: Record<string, string> = { from: from.toISOString(), to: to.toISOString() };
  for (const k of FILTER_KEYS) if (!["preset", "from", "to"].includes(k) && sp[k]) p[k] = sp[k]!;
  return p;
}

export function pickFilters(sp: Record<string, string | undefined>): FilterParams {
  const out: FilterParams = {};
  for (const k of FILTER_KEYS) if (sp[k]) out[k] = sp[k];
  return out;
}

export const pct = (num: number, den: number) => (den ? ((num / den) * 100).toFixed(1) + "%" : "—");

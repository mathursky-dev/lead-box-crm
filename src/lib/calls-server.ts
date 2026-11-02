import "server-only";
import type { CallRow } from "./calls";

export const CALL_SELECT = "id,direction,started_at,duration_sec,phone_e164,outcome,note,source,recording_path,user_id,lead_id," +
  "user:lb_profiles!lb_calls_user_id_fkey(full_name),lead:lb_leads(lead_no),customer:lb_customers(name)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toCallRow(r: any): CallRow {
  return {
    id: r.id, direction: r.direction, started_at: r.started_at, duration_sec: r.duration_sec, phone_e164: r.phone_e164, outcome: r.outcome, note: r.note ?? "",
    source: r.source, has_recording: Boolean(r.recording_path), user_id: r.user_id, user_name: r.user?.full_name ?? (r.user_id ? "User" : "Not answered"), lead_id: r.lead_id,
    lead_no: r.lead?.lead_no ?? null, customer_name: r.customer?.name ?? null,
  };
}

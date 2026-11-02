// Shared (client + server) helpers for call tracking.

export const CALL_OUTCOMES = [
  { value: "connected", label: "Connected" },
  { value: "interested", label: "Interested" },
  { value: "not_interested", label: "Not interested" },
  { value: "call_back", label: "Call back later" },
  { value: "busy", label: "Busy" },
  { value: "no_answer", label: "No answer" },
  { value: "switched_off", label: "Switched off" },
  { value: "wrong_number", label: "Wrong number" },
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number]["value"];
export const outcomeLabel = (v?: string | null) => CALL_OUTCOMES.find((o) => o.value === v)?.label ?? "";

export const CALL_DIRECTIONS = [
  { value: "outgoing", label: "Outgoing", cls: "bg-emerald-50 text-emerald-700" },
  { value: "incoming", label: "Incoming", cls: "bg-sky-50 text-sky-700" },
  { value: "missed", label: "Missed", cls: "bg-red-50 text-red-700" },
  { value: "rejected", label: "Rejected", cls: "bg-slate-100 text-slate-600" },
] as const;
export const directionOf = (v: string) => CALL_DIRECTIONS.find((d) => d.value === v) ?? CALL_DIRECTIONS[0];

/** 0 → "0s", 75 → "1m 15s", 3725 → "1h 2m 5s". */
export function fmtDuration(sec?: number | null) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h ? `${h}h` : "", h || m ? `${m}m` : "", `${r}s`].filter(Boolean).join(" ");
}

/** A call row as the UI shows it. */
export type CallRow = {
  id: string; direction: string; started_at: string; duration_sec: number; phone_e164: string; outcome: string | null; note: string;
  source: string; has_recording: boolean; user_id: string; user_name: string; lead_id: string | null; lead_no?: number | null; customer_name?: string | null;
};

// What the Android app sends (see mobile/README.md).
export type DeviceCall = { key: string; number: string; direction: string; startedAt: number; duration: number; source?: "app" | "app_lite" };

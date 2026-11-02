// Shared (client + server) bits of Customer care: portal, appointments, feedback / NPS, referrals.

export const APPT_STATUSES = [
  { value: "booked", label: "Booked", cls: "bg-amber-100 text-amber-800" },
  { value: "confirmed", label: "Confirmed", cls: "bg-blue-100 text-blue-800" },
  { value: "done", label: "Done", cls: "bg-green-100 text-green-800" },
  { value: "no_show", label: "No-show", cls: "bg-red-50 text-red-700" },
  { value: "cancelled", label: "Cancelled", cls: "bg-slate-200 text-slate-600" },
] as const;
export const apptStatus = (v: string) => APPT_STATUSES.find((s) => s.value === v) ?? APPT_STATUSES[0];

export const REF_STATUSES = [
  { value: "pending", label: "In progress", cls: "bg-amber-100 text-amber-800" },
  { value: "won", label: "Won · reward due", cls: "bg-green-100 text-green-800" },
  { value: "rewarded", label: "Rewarded", cls: "bg-violet-100 text-violet-800" },
  { value: "lost", label: "Lost", cls: "bg-slate-200 text-slate-600" },
] as const;
export const refStatus = (v: string) => REF_STATUSES.find((s) => s.value === v) ?? REF_STATUSES[0];

export const FEEDBACK_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Waiting to send", cls: "bg-amber-100 text-amber-800" },
  sent: { label: "Sent", cls: "bg-blue-100 text-blue-800" },
  answered: { label: "Answered", cls: "bg-green-100 text-green-800" },
  not_sent: { label: "Not sent", cls: "bg-slate-200 text-slate-600" },
};

/** NPS bucket of a 0–10 score. */
export const npsBucket = (s: number) => (s >= 9 ? "promoter" : s >= 7 ? "passive" : "detractor");
export const NPS_CLS: Record<string, string> = { promoter: "bg-green-100 text-green-800", passive: "bg-amber-100 text-amber-800", detractor: "bg-red-100 text-red-700" };

/** NPS = % promoters − % detractors (null when there are no answers). */
export function nps(scores: number[]) {
  if (!scores.length) return null;
  const p = scores.filter((s) => s >= 9).length, d = scores.filter((s) => s <= 6).length;
  return Math.round(((p - d) / scores.length) * 100);
}

export const DAYS = [
  { key: "1", label: "Mon" }, { key: "2", label: "Tue" }, { key: "3", label: "Wed" }, { key: "4", label: "Thu" },
  { key: "5", label: "Fri" }, { key: "6", label: "Sat" }, { key: "7", label: "Sun" },
] as const;
export type WeekHours = Record<string, [string, string]>;

export type CareSettings = {
  portal_enabled: boolean; portal_note: string;
  booking_enabled: boolean; booking_code: string | null; booking_title: string; booking_intro: string; booking_location: string;
  slot_minutes: number; slot_capacity: number; days_ahead: number; min_notice_hours: number; week_hours: WeekHours; closed_dates: string[];
  booking_source_id: string | null; booking_thank_you: string;
  feedback_auto: boolean; feedback_delay_hours: number; feedback_question: string; feedback_message: string; review_url: string | null;
  referral_enabled: boolean; referral_reward: string; referral_message: string; referral_source_id: string | null;
};
export const CARE_COLS = "portal_enabled,portal_note,booking_enabled,booking_code,booking_title,booking_intro,booking_location,slot_minutes,slot_capacity,days_ahead,min_notice_hours,week_hours,closed_dates,booking_source_id,booking_thank_you,feedback_auto,feedback_delay_hours,feedback_question,feedback_message,review_url,referral_enabled,referral_reward,referral_message,referral_source_id";

export const CARE_DEFAULTS: CareSettings = {
  portal_enabled: true, portal_note: "",
  booking_enabled: false, booking_code: null, booking_title: "Book an appointment", booking_intro: "", booking_location: "",
  slot_minutes: 30, slot_capacity: 1, days_ahead: 14, min_notice_hours: 2,
  week_hours: { "1": ["10:00", "18:00"], "2": ["10:00", "18:00"], "3": ["10:00", "18:00"], "4": ["10:00", "18:00"], "5": ["10:00", "18:00"], "6": ["10:00", "14:00"] },
  closed_dates: [], booking_source_id: null, booking_thank_you: "Your appointment is booked. We will confirm it on WhatsApp.",
  feedback_auto: false, feedback_delay_hours: 2, feedback_question: "How likely are you to recommend us to a friend or family member?",
  feedback_message: "Hi {name}, thank you for choosing {company}! 🙏 Please rate your experience, it takes 10 seconds: {link}", review_url: null,
  referral_enabled: true, referral_reward: "", referral_message: "Hi {name}! Refer your friends to {company}. Share this link with them: {link}", referral_source_id: null,
};

/** {name} {company} {link} placeholders. */
export const fillTemplate = (tpl: string, v: { name?: string | null; company?: string | null; link: string }) => {
  const out = tpl.replaceAll("{name}", v.name?.trim() || "there").replaceAll("{company}", v.company ?? "").replaceAll("{link}", v.link);
  return out.includes(v.link) ? out : `${out}\n${v.link}`;
};

export const careUrl = (origin: string, kind: "portal" | "booking" | "feedback" | "referral", key: string) =>
  `${origin.replace(/\/$/, "")}/${{ portal: "p", booking: "b", feedback: "r", referral: "ref" }[kind]}/${key}`;

/** Current time in ms (helper so server components don't call Date.now during render). */
export const nowMs = () => Date.now();

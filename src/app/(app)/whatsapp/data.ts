import "server-only";
import { createClient } from "@/lib/supabase/server";

export type WaReport = {
  sent: number; received: number; delivered: number; read: number; failed: number; queued: number; automated: number; chats: number;
  daily: { day: string; sent: number; received: number; failed: number }[];
  hours: { h: number; in: number; out: number }[];
  by_number: { label: string; display_phone: string | null; sent: number; received: number; failed: number }[];
  templates: { name: string; sent: number; read: number; failed: number }[];
  errors: { code: string; message: string; n: number }[];
  categories: { category: string; n: number }[];
  agents: { name: string; replies: number; chats: number }[];
  bots: { replies: number; unmatched: number; optouts: number; away: number };
  automated_templates: number;
};

export async function waReport(from: Date, to: Date): Promise<WaReport> {
  const { data, error } = await (await createClient()).rpc("lb_wa_report", { p_from: from.toISOString(), p_to: to.toISOString(), p_tz: "Asia/Kolkata" });
  if (error) throw new Error(error.message);
  return data as WaReport;
}

export const dayLabel = (d: string) => d.slice(5).replace("-", "/");

/** ISO timestamp `ms` milliseconds ago (kept out of render bodies for the purity lint). */
export const agoIso = (ms: number) => new Date(Date.now() - ms).toISOString();

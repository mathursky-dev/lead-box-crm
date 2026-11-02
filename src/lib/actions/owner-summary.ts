"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { drainAlerts } from "@/lib/alerts";
import { errMsg } from "@/lib/util";
import type { FormState } from "@/components/ui";

// Nightly WhatsApp summary to the owner (lb_owner_summary_settings, cron lb-owner-summary).

const Settings = z.object({
  send_hour: z.coerce.number().int().min(0).max(23),
  wa_number_id: z.union([z.uuid(), z.literal("")]).default(""),
  wa_template: z.string().trim().max(120).regex(/^[a-z0-9_]*$/, "Template name: lowercase letters, digits and _ only").default(""),
  wa_template_lang: z.string().trim().max(15).default("en"),
});

export async function saveOwnerSummary(_: FormState, fd: FormData): Promise<FormState> {
  const { profile } = await requireAdmin();
  const p = Settings.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form" };
  const recipients = z.array(z.uuid()).max(200).safeParse(fd.getAll("recipients"));
  if (!recipients.success) return { error: "Pick valid users" };
  const sb = await createClient();
  // Moving the time later than now (IST) on a day it already went out does not resend; moving it
  // earlier than now on a day it has not gone out sends at the next run.
  const { error } = await sb.from("lb_owner_summary_settings").upsert({
    company_id: profile.company_id, enabled: fd.get("enabled") === "on", send_hour: p.data.send_hour,
    recipients: recipients.data, wa_number_id: p.data.wa_number_id || null,
    wa_template: p.data.wa_template || null, wa_template_lang: p.data.wa_template_lang || "en",
    updated_at: new Date().toISOString(), updated_by: profile.id,
  }, { onConflict: "company_id" });
  if (error) return { error: errMsg(error) };
  revalidatePath("/admin/daily-summary");
  return { ok: "Daily summary settings saved." };
}

/** Sends today's summary to the signed-in admin right now (in-app + WhatsApp). */
export async function sendOwnerSummaryNow(): Promise<{ error?: string; ok?: string }> {
  const { profile } = await requireAdmin();
  const db = createAdminClient();
  const key = `ostest:${profile.id}:${Date.now()}`;
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const { error } = await db.rpc("lb__queue_owner_summary", { p_company: profile.company_id, p_day: today, p_only: profile.id, p_key: key });
  if (error) return { error: errMsg(error) };
  await drainAlerts(8000);
  const { data: rows } = await db.from("lb_alert_queue").select("status,error").eq("dedupe_key", `wa:${key}:${profile.id}`);
  const r = rows?.[0];
  if (!r) return { ok: "Shown in your notifications (bell). WhatsApp not sent: add your mobile number on the Users page and connect a WhatsApp number." };
  if (r.status === "failed") return { error: `In-app sent. WhatsApp failed: ${r.error}` };
  if (r.status === "sent") return { ok: "Sent on WhatsApp and in the app." };
  return { ok: "Queued: WhatsApp will go out in a minute." };
}

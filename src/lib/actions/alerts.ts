"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireProfile } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { drainAlerts, vapidKeys } from "@/lib/alerts";
import { errMsg } from "@/lib/util";
import type { FormState } from "@/components/ui";

// Follow-up alert settings, push subscriptions and monthly targets.

/** Public VAPID key for the browser's push subscription. */
export async function pushPublicKey(): Promise<string | null> {
  await requireProfile();
  try { return (await vapidKeys()).publicKey; } catch { return null; }
}

const Sub = z.object({
  endpoint: z.url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
});

/** Save this browser/phone's push subscription for the signed-in user. */
export async function savePushSubscription(sub: unknown, userAgent: string): Promise<{ error?: string }> {
  const { profile } = await requireProfile();
  const p = Sub.safeParse(sub);
  if (!p.success) return { error: "This browser returned an invalid push subscription." };
  // The endpoint may have belonged to another user who used this browser before: move it.
  await createAdminClient().from("lb_push_subs").delete().eq("endpoint", p.data.endpoint).neq("user_id", profile.id);
  const { error } = await (await createClient()).from("lb_push_subs").upsert({
    user_id: profile.id, company_id: profile.company_id, endpoint: p.data.endpoint,
    p256dh: p.data.keys.p256dh, auth: p.data.keys.auth, user_agent: userAgent.slice(0, 300), failures: 0,
  }, { onConflict: "endpoint" });
  return error ? { error: errMsg(error) } : {};
}

export async function removePushSubscription(endpoint: string): Promise<{ error?: string }> {
  await requireProfile();
  const { error } = await (await createClient()).from("lb_push_subs").delete().eq("endpoint", endpoint);
  return error ? { error: errMsg(error) } : {};
}

/** Sends a test push (and WhatsApp, if on) to the signed-in user right now. */
export async function sendTestAlert(): Promise<{ error?: string; ok?: string }> {
  const { profile } = await requireProfile();
  const db = createAdminClient();
  const key = `test:${profile.id}:${Date.now()}`;
  const rows: Record<string, unknown>[] = [];
  const { count } = await db.from("lb_push_subs").select("id", { count: "exact", head: true }).eq("user_id", profile.id);
  if (count) rows.push({ channel: "push" });
  const { data: s } = await db.from("lb_alert_settings").select("wa_enabled,wa_number_id").eq("company_id", profile.company_id).maybeSingle();
  if (s?.wa_enabled && s.wa_number_id) rows.push({ channel: "whatsapp" });
  if (!rows.length) return { error: "Turn on notifications on this phone first, or turn on WhatsApp alerts." };
  const { error } = await db.from("lb_alert_queue").insert(rows.map((r) => ({
    ...r, company_id: profile.company_id, user_id: profile.id, kind: "test",
    title: "Test alert from Lead Box", body: "Follow-up alerts are working on this device.", link: "/followups",
    dedupe_key: `${key}:${r.channel}`,
  })));
  if (error) return { error: errMsg(error) };
  await drainAlerts(8000);
  const { data: res } = await db.from("lb_alert_queue").select("channel,status,error").like("dedupe_key", `${key}:%`);
  const bad = (res ?? []).filter((r) => r.status === "failed");
  if (bad.length) return { error: bad.map((r) => `${r.channel === "push" ? "Push" : "WhatsApp"}: ${r.error}`).join(" · ") };
  return { ok: `Sent: ${(res ?? []).map((r) => (r.channel === "push" ? "push" : "WhatsApp")).join(" + ")}` };
}

const Settings = z.object({
  missed_after_min: z.coerce.number().int().min(0).max(1440),
  manager_list_hour: z.coerce.number().int().min(0).max(23),
  wa_number_id: z.union([z.uuid(), z.literal("")]).default(""),
  wa_template: z.string().trim().max(120).regex(/^[a-z0-9_]*$/, "Template name: lowercase letters, digits and _ only").default(""),
  wa_template_lang: z.string().trim().max(15).default("en"),
});

export async function saveAlertSettings(_: FormState, fd: FormData): Promise<FormState> {
  const { profile } = await requireAdmin();
  const p = Settings.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form" };
  const on = (k: string) => fd.get(k) === "on";
  const row = {
    company_id: profile.company_id,
    missed_enabled: on("missed_enabled"), missed_after_min: p.data.missed_after_min,
    manager_list_enabled: on("manager_list_enabled"), manager_list_hour: p.data.manager_list_hour,
    push_enabled: on("push_enabled"), wa_enabled: on("wa_enabled"),
    wa_number_id: p.data.wa_number_id || null, wa_template: p.data.wa_template || null, wa_template_lang: p.data.wa_template_lang || "en",
    updated_at: new Date().toISOString(), updated_by: profile.id,
  };
  if (row.wa_enabled && !row.wa_number_id) return { error: "Choose the WhatsApp number that sends alerts." };
  const { error } = await (await createClient()).from("lb_alert_settings").upsert(row, { onConflict: "company_id" });
  if (error) return { error: errMsg(error) };
  revalidatePath("/admin/alerts");
  return { ok: "Alert settings saved." };
}

const Targets = z.array(z.object({
  user_id: z.uuid(),
  won_target: z.union([z.coerce.number().int().min(0).max(100000), z.literal("")]),
  value_target: z.union([z.coerce.number().min(0).max(1e11), z.literal("")]),
})).max(500);

/** Save monthly targets (admins: anyone, team leaders: their team; checked in lb_set_targets). */
export async function saveTargets(month: string, rows: unknown): Promise<{ error?: string; ok?: string }> {
  await requireProfile();
  if (!/^\d{4}-\d{2}-01$/.test(month)) return { error: "Invalid month" };
  const p = Targets.safeParse(rows);
  if (!p.success) return { error: "Targets must be whole numbers (0 or more)." };
  const { error } = await (await createClient()).rpc("lb_set_targets", {
    p_month: month, p_rows: p.data.map((r) => ({ user_id: r.user_id, won_target: String(r.won_target), value_target: String(r.value_target) })),
  });
  if (error) return { error: errMsg(error) };
  revalidatePath("/leaderboard");
  return { ok: "Targets saved." };
}

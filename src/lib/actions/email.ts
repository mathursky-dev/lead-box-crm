"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, can } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { errMsg } from "@/lib/util";
import { demoBlocked } from "@/lib/demo";
import { googleConfigured, sendEmail, syncAccount } from "@/lib/google";

type FormState = { error?: string; ok?: string } | undefined;

async function myAccount() {
  const { profile } = await requireProfile();
  const { data } = await createAdminClient().from("lb_google_accounts").select("id,email,is_active").eq("user_id", profile.id).maybeSingle();
  return { profile, account: data };
}

export async function syncMyGmail(): Promise<FormState> {
  try {
    const { account } = await myAccount();
    if (!account) return { error: "Connect your Gmail first." };
    if (!googleConfigured()) return { error: "Gmail is not switched on (Google keys missing on the server)." };
    if (!account.is_active) await createAdminClient().from("lb_google_accounts").update({ is_active: true }).eq("id", account.id);
    const r = await syncAccount(account.id, Date.now() + 40000);
    revalidatePath("/email");
    return { ok: r.stored ? `${r.stored} new customer email${r.stored === 1 ? "" : "s"} added.` : "Up to date. No new customer emails." };
  } catch (e) {
    revalidatePath("/email");
    return { error: errMsg(e) };
  }
}

export async function disconnectGmail(): Promise<FormState> {
  try {
    const { account } = await myAccount();
    if (!account) return { ok: "Not connected." };
    // Mails already on leads stay; the token is deleted.
    await createAdminClient().from("lb_google_accounts").delete().eq("id", account.id);
    revalidatePath("/email");
    return { ok: `Disconnected ${account.email}. Emails already saved on leads stay there.` };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export async function sendLeadEmail(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { profile } = await requireProfile();
    { const demo = await demoBlocked(profile.company_id); if (demo) return { error: demo }; }
    if (!can(profile, "chats.send")) return { error: "You are not allowed to message customers." };
    const p = z.object({
      lead_id: z.uuid(),
      subject: z.string().trim().min(1, "Subject is required").max(300),
      body: z.string().trim().min(1, "Write the email").max(20000),
      thread_id: z.string().max(100).optional(),
    }).safeParse(Object.fromEntries(form));
    if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the email." };
    // RLS: the user must be able to see this lead.
    const { data: lead } = await (await createClient()).from("lb_leads").select("id,customer:lb_customers(email)").eq("id", p.data.lead_id).maybeSingle();
    const to = (lead?.customer as unknown as { email: string | null } | null)?.email;
    if (!lead) return { error: "Lead not found." };
    if (!to) return { error: "This customer has no email address. Add it in Edit lead first." };
    await sendEmail({ userId: profile.id, to, subject: p.data.subject, body: p.data.body, threadId: p.data.thread_id || null });
    revalidatePath(`/leads/${p.data.lead_id}`);
    return { ok: `Email sent to ${to}.` };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

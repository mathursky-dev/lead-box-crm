import { headers } from "next/headers";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { quoteSettings } from "@/lib/quotes-server";
import { QuoteSettingsForm, RazorpayForm } from "./forms";

export const metadata = { title: "Quotes & Payments" };

export default async function QuoteSettingsPage() {
  const { profile } = await requireProfile();
  const [st, { data: statuses }] = await Promise.all([
    quoteSettings(profile.company_id),
    (await createClient()).from("lb_lead_statuses").select("id,name,category").eq("company_id", profile.company_id).eq("is_active", true).order("sort_order"),
  ]);
  const h = await headers();
  const base = process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <QuoteSettingsForm st={st} statuses={(statuses ?? []).filter((s) => !["won", "lost", "invalid"].includes(s.category))} />
      <RazorpayForm keyId={st.rzp_key_id} hasSecret={st.has_rzp_secret} hasWebhook={st.has_webhook_secret}
        webhookUrl={`${base}/api/pay/razorpay/webhook/${profile.company_id}`} />
    </div>
  );
}

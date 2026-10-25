import { WA_API_SETUP } from "@/components/guides";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { PageHeader } from "@/components/static";
import { fmtDateTime } from "@/lib/dates";
import { MetaForm, VerifyToken, CopyField } from "./forms";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const { profile } = await requireAdmin();
  const h = await headers();
  const base = process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const callback = `${base}/api/whatsapp/webhook`;
  const svc = hasServiceRole();

  let integ: { meta_app_id: string | null; verify_token: string | null; app_secret_enc: string | null; updated_at: string } | null = null;
  let stats = { numbers: 0, connected: 0, lastWebhook: null as string | null, pendingEvents: 0, failedEvents: 0, queued: 0, failedMsgs: 0, templates: 0 };
  if (svc) {
    const db = createAdminClient();
    const [i, n, pe, fe, q, fm, t] = await Promise.all([
      db.from("lb_integrations").select("meta_app_id,verify_token,app_secret_enc,updated_at").eq("company_id", profile.company_id).maybeSingle(),
      db.from("lb_wa_numbers").select("status,last_webhook_at").eq("company_id", profile.company_id),
      db.from("lb_webhook_events").select("id", { count: "exact", head: true }).is("processed_at", null).is("error", null),
      db.from("lb_webhook_events").select("id", { count: "exact", head: true }).is("processed_at", null).not("error", "is", null),
      db.from("lb_messages").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id).in("status", ["queued", "sending"]),
      db.from("lb_messages").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id).eq("status", "failed"),
      db.from("lb_wa_templates").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id).eq("status", "APPROVED"),
    ]);
    integ = i.data;
    const nums = n.data ?? [];
    stats = {
      numbers: nums.length, connected: nums.filter((x) => x.status === "connected").length,
      lastWebhook: nums.map((x) => x.last_webhook_at).filter(Boolean).sort().at(-1) ?? null,
      pendingEvents: pe.count ?? 0, failedEvents: fe.count ?? 0, queued: q.count ?? 0, failedMsgs: fm.count ?? 0, templates: t.count ?? 0,
    };
  }
  const verifyToken = integ?.verify_token ?? null;
  const hasEnvToken = Boolean(process.env.WHATSAPP_VERIFY_TOKEN);
  const secretSet = Boolean(integ?.app_secret_enc) || Boolean(process.env.WHATSAPP_APP_SECRET);

  const checks: [string, boolean, string][] = [
    ["Server service key", svc, "SUPABASE_SERVICE_ROLE_KEY in Vercel → Environment Variables"],
    ["Encryption key", Boolean(process.env.LB_SECRETS_KEY), "LB_SECRETS_KEY (protects tokens and the App Secret)"],
    ["Public app URL", Boolean(process.env.APP_URL), "APP_URL, used in links and the callback URL"],
    ["Webhook verify token", Boolean(verifyToken) || hasEnvToken, "Generate one below or set WHATSAPP_VERIFY_TOKEN"],
    ["Meta App Secret", secretSet, "Paste it below (Meta App → Settings → Basic) or set WHATSAPP_APP_SECRET"],
    ["Background jobs secret", Boolean(process.env.CRON_SECRET), "CRON_SECRET, for retries and webhook replay"],
    ["WhatsApp number connected", stats.connected > 0, `${stats.connected}/${stats.numbers} connected — Admin → WhatsApp numbers`],
    ["Webhook receiving events", Boolean(stats.lastWebhook), stats.lastWebhook ? `Last event ${fmtDateTime(stats.lastWebhook)}` : "No event received yet"],
    ["Approved templates synced", stats.templates > 0, `${stats.templates} approved template(s)`],
  ];
  const ok = checks.filter((c) => c[1]).length;

  return (
    <>
      <PageHeader icon="link" tone="blue" title="Integration master" sub="Everything needed to connect LEAD BOX to the official WhatsApp Business Platform (Cloud API)." />

      <section className="card mb-4 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-navy-900">Health check</h2>
          <span className={`badge ${ok === checks.length ? "bg-brand-100 text-brand-700" : "bg-amber-50 text-amber-800"}`}>{ok}/{checks.length} ready</span>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {checks.map(([label, pass, hint]) => (
            <li key={label} className="flex items-start gap-2 text-sm">
              <span className={pass ? "text-brand-600" : "text-red-600"} aria-label={pass ? "ready" : "missing"}>{pass ? "✓" : "✗"}</span>
              <span><span className="font-medium text-navy-900">{label}</span><span className="block text-xs text-slate-500">{hint}</span></span>
            </li>
          ))}
        </ul>
        {svc && (stats.pendingEvents + stats.failedEvents + stats.queued + stats.failedMsgs > 0) && (
          <p className="mt-3 text-xs text-slate-600">
            Webhook events waiting: {stats.pendingEvents} · failed (will retry): {stats.failedEvents} · messages queued/sending: {stats.queued} · failed messages: {stats.failedMsgs}
          </p>
        )}
      </section>

      <section className="card mb-4 p-4">
        <h2 className="mb-1 text-sm font-semibold text-navy-900">Webhook configuration <span className="font-normal text-slate-500">(Meta App → WhatsApp → Configuration)</span></h2>
        <p className="mb-3 text-xs text-slate-500">Paste these two values into Meta, click <b>Verify and save</b>, then subscribe the <b>messages</b> webhook field.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          <CopyField label="Callback URL" value={callback} />
          <VerifyToken token={verifyToken} envFallback={hasEnvToken} disabled={!svc} />
        </div>
      </section>

      <section className="card mb-4 p-4">
        <h2 className="mb-1 text-sm font-semibold text-navy-900">Meta app credentials</h2>
        <p className="mb-3 text-xs text-slate-500">Used to validate the X-Hub-Signature-256 header on every webhook delivery. The App Secret is encrypted and never shown again.</p>
        <MetaForm appId={integ?.meta_app_id ?? ""} secretSaved={Boolean(integ?.app_secret_enc)} envSecret={Boolean(process.env.WHATSAPP_APP_SECRET)} disabled={!svc}
          updated={integ?.updated_at ? fmtDateTime(integ.updated_at) : null} />
      </section>

      <section className="card p-4 text-sm">
        <h2 className="mb-2 text-sm font-semibold text-navy-900">Setup steps</h2>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700">
          {WA_API_SETUP.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      </section>
    </>
  );
}

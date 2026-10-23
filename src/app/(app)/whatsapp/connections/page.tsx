import Link from "next/link";
import { headers } from "next/headers";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient, hasServiceRole } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { fmtDateTime } from "@/lib/dates";
import { fmtNum } from "@/lib/wa";
import { NumberForm, NumberActions } from "../../admin/numbers/number-form";
import { CopyField } from "../../admin/integrations/forms";
import { Panel, EmptyState, Notice, Icon } from "../ui";

export const metadata = { title: "Connections · WhatsApp" };
const STATE: Record<string, string> = { connected: "bg-brand-100 text-brand-700", disconnected: "bg-slate-200 text-slate-700", error: "bg-red-100 text-red-700" };
const QUALITY: Record<string, string> = { GREEN: "text-brand-700", YELLOW: "text-amber-600", RED: "text-red-600" };

export default async function Connections() {
  const { profile } = await requireProfile();
  const admin = isAdmin(profile);
  const sb = await createClient();
  const h = await headers();
  const base = process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const [refs, { data: numbers }, { data: nt }, { data: nu }] = await Promise.all([
    loadRefs(),
    sb.from("lb_wa_numbers").select("*").order("label"),
    sb.from("lb_wa_number_teams").select("number_id,team_id"),
    sb.from("lb_wa_number_users").select("number_id,user_id"),
  ]);
  const ready = hasServiceRole() && Boolean(process.env.LB_SECRETS_KEY);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {!ready && <Notice tone="red">Server settings missing (SUPABASE_SERVICE_ROLE_KEY / LB_SECRETS_KEY) — numbers cannot be connected until they are set in Vercel.</Notice>}
        <Panel title="Connect a WhatsApp number" icon="plug">
          <p className="mb-3 text-sm text-slate-600">
            Official WhatsApp Business Platform (Cloud API). You need the <b>Phone number ID</b>, the <b>WhatsApp Business Account ID</b> and a permanent
            <b> System User access token</b> from Meta Business Settings. The token is verified with Meta, encrypted, and never sent to the browser.
            The number must not be active on the WhatsApp app.
          </p>
          {admin ? (ready ? <NumberForm refs={refs} /> : null) : <p className="text-sm text-amber-700">Only an admin can connect numbers.</p>}
        </Panel>
        <Panel title="Connected numbers" icon="chat" actions={<Link href="/whatsapp/connections" className="btn-ghost btn-sm">Refresh</Link>}>
          {!numbers?.length ? (
            <EmptyState icon="plug" title="No numbers connected">Use <b>Connect number</b> above. After connecting: Test connection → Subscribe webhook → Sync templates.</EmptyState>
          ) : (
            <div className="space-y-3">
              {numbers.map((n) => (
                <div key={n.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-navy-900">{n.label}</span>
                        <span className={`badge ${STATE[n.status]}`}>{n.status}</span>
                        {!n.is_active && <span className="badge bg-slate-200">disabled</span>}
                        {n.quality_rating && <span className={`text-xs font-semibold ${QUALITY[n.quality_rating] ?? ""}`}>quality {n.quality_rating}</span>}
                      </div>
                      <div className="text-sm text-slate-600">{n.verified_name ?? "—"} · {n.display_phone ?? "—"} · credits ₹{fmtNum(n.credit_balance)}</div>
                      <div className="text-xs text-slate-500">Phone number ID {n.phone_number_id} · WABA {n.waba_id}</div>
                      <div className="text-xs text-slate-500">Checked {fmtDateTime(n.last_checked_at)} · last webhook {fmtDateTime(n.last_webhook_at)}</div>
                      {n.last_error && <div className="mt-1 text-sm text-red-700">{n.last_error}</div>}
                    </div>
                    {admin && (
                      <div className="flex flex-wrap gap-1">
                        <NumberActions id={n.id} />
                        <NumberForm refs={refs} number={{ ...n, teams: (nt ?? []).filter((x) => x.number_id === n.id).map((x) => x.team_id), users: (nu ?? []).filter((x) => x.number_id === n.id).map((x) => x.user_id) }} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
      <div className="space-y-4">
        <Panel title="Meta app URLs" icon="link">
          <p className="mb-3 text-xs text-slate-500">Add these in <b>Meta for Developers → your app → WhatsApp → Configuration</b>. Subscribe the <b>messages</b> field.</p>
          <div className="space-y-3">
            <CopyField label="Webhook callback URL" value={`${base}/api/whatsapp/webhook`} />
            <CopyField label="Facebook lead ads webhook" value={`${base}/api/facebook/webhook`} />
          </div>
          <p className="mt-3 text-xs text-slate-500">Verify token and App Secret: <Link className="text-brand-700 hover:underline" href="/admin/integrations">Admin → Integrations</Link>.</p>
        </Panel>
        <Panel title="Checklist" icon="check">
          <ol className="list-decimal space-y-1 pl-4 text-sm text-slate-600">
            <li>Create a System User in Business Settings, give it the WhatsApp account, generate a permanent token.</li>
            <li>Connect the number here (token is tested live).</li>
            <li>Press <b>Subscribe webhook</b> so Meta sends messages to this CRM.</li>
            <li>Press <b>Sync templates</b>, then send a test from <Link className="text-brand-700 hover:underline" href="/whatsapp/send">Send</Link>.</li>
          </ol>
          <p className="mt-3 flex items-center gap-1 text-xs text-slate-500"><Icon name="wallet" className="h-3.5 w-3.5" /> Message credits per number are topped up from the company wallet.</p>
        </Panel>
      </div>
    </div>
  );
}

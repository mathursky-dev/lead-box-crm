import Link from "next/link";
import { createClient, hasServiceRole } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader, Empty, ErrorBox } from "@/components/static";
import { fmtDateTime } from "@/lib/dates";
import { NumberForm, NumberActions } from "./number-form";

export const metadata = { title: "WhatsApp numbers" };

const STATE: Record<string, string> = { connected: "bg-brand-100 text-brand-700", disconnected: "bg-slate-200 text-slate-700", error: "bg-red-100 text-red-700" };

export default async function NumbersPage() {
  const refs = await loadRefs();
  const sb = await createClient();
  const [{ data: numbers }, { data: nt }, { data: nu }] = await Promise.all([
    sb.from("lb_wa_numbers").select("*").order("label"),
    sb.from("lb_wa_number_teams").select("number_id,team_id"),
    sb.from("lb_wa_number_users").select("number_id,user_id"),
  ]);
  const missing = [
    !hasServiceRole() && "SUPABASE_SERVICE_ROLE_KEY",
    !process.env.LB_SECRETS_KEY && "LB_SECRETS_KEY",
  ].filter(Boolean);
  return (
    <>
      <PageHeader title="WhatsApp Business numbers" sub="Official WhatsApp Business Platform (Cloud API). Tokens are verified with Meta, encrypted, and never sent to the browser."
        actions={missing.length === 0 ? <NumberForm refs={refs} /> : null} />
      {missing.length > 0 && <div className="mb-4"><ErrorBox message={`WhatsApp is disconnected: server setting(s) missing — ${missing.join(", ")}.`} /></div>}
      <p className="mb-4 text-sm text-slate-600">Webhook callback URL, verify token and Meta App Secret are managed in <Link className="text-brand-700 hover:underline" href="/admin/integrations">Integrations</Link>.</p>
      {!numbers?.length ? <Empty title="No numbers connected">Add a number with its Phone number ID, WhatsApp Business Account ID and a System User access token.</Empty> : (
        <div className="space-y-3">
          {numbers.map((n) => (
            <div key={n.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-navy-900">{n.label}</span>
                    <span className={`badge ${STATE[n.status]}`}>{n.status}</span>
                    {!n.is_active && <span className="badge bg-slate-200">disabled</span>}
                  </div>
                  <div className="text-sm text-slate-600">{n.verified_name ?? "—"} · {n.display_phone ?? "—"} {n.quality_rating && <>· quality {n.quality_rating}</>}</div>
                  <div className="text-xs text-slate-500">Phone number ID {n.phone_number_id} · WABA {n.waba_id} · checked {fmtDateTime(n.last_checked_at)} · last webhook {fmtDateTime(n.last_webhook_at)}</div>
                  {n.last_error && <div className="mt-1 text-sm text-red-700">{n.last_error}</div>}
                </div>
                <div className="flex flex-wrap gap-1">
                  <NumberActions id={n.id} />
                  <NumberForm refs={refs} number={{ ...n, teams: (nt ?? []).filter((x) => x.number_id === n.id).map((x) => x.team_id), users: (nu ?? []).filter((x) => x.number_id === n.id).map((x) => x.user_id) }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { ActionForm, Field, Submit } from "@/components/ui";
import { Notice, Panel } from "@/components/kit";
import { saveOwnerSummary } from "@/lib/actions/owner-summary";
import { fmtDateTime } from "@/lib/dates";
import { SendNow } from "./send-now";

export const metadata = { title: "Daily summary" };

const STATUS_STYLE: Record<string, string> = {
  sent: "bg-emerald-50 text-emerald-700", failed: "bg-red-50 text-red-700", queued: "bg-amber-50 text-amber-700", sending: "bg-sky-50 text-sky-700",
};

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;

export default async function DailySummaryPage() {
  const { profile } = await requireAdmin();
  const sb = await createClient();
  const [{ data: s }, { data: numbers }, { data: users }, preview, { data: log }] = await Promise.all([
    sb.from("lb_owner_summary_settings").select("*").eq("company_id", profile.company_id).maybeSingle(),
    sb.from("lb_wa_numbers").select("id,label,display_phone,is_active").eq("company_id", profile.company_id).order("label"),
    sb.from("lb_profiles").select("id,full_name,role,phone").eq("company_id", profile.company_id).eq("is_active", true).neq("role", "super_admin").order("full_name"),
    sb.rpc("lb_owner_summary_preview"),
    sb.from("lb_alert_queue").select("id,status,error,created_at,user:lb_profiles(full_name)")
      .eq("company_id", profile.company_id).eq("kind", "owner_summary").order("created_at", { ascending: false }).limit(20),
  ]);
  if (preview.error) return <ErrorBox message={preview.error.message} />;
  const v = {
    enabled: s?.enabled ?? true, send_hour: s?.send_hour ?? 21, recipients: (s?.recipients ?? []) as string[],
    wa_number_id: s?.wa_number_id ?? "", wa_template: s?.wa_template ?? "", wa_template_lang: s?.wa_template_lang ?? "en",
  };
  const people = users ?? [];
  const chosen = v.recipients.length ? people.filter((u) => v.recipients.includes(u.id)) : people.filter((u) => u.role === "company_admin");
  const noPhone = chosen.filter((u) => !u.phone?.trim());
  const text = (preview.data as { text?: string } | null)?.text ?? "";

  return (
    <>
      <PageHeader icon="chart" tone="green" title="Daily summary"
        sub="Every night the owner gets today's numbers on WhatsApp: new leads, sales, payments and pending tasks." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="card p-5">
          <ActionForm action={saveOwnerSummary}>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={v.enabled} className="mt-1" />
              <span><b>Send the daily summary</b> every night on WhatsApp and in the app.</span></label>
            <Field label="Send at (IST)">
              <select className="input w-40" name="send_hour" defaultValue={v.send_hour}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </Field>
            <fieldset>
              <legend className="label">Send to</legend>
              <p className="mb-1 text-xs text-slate-500">Nobody ticked = all company admins.</p>
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
                {people.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="recipients" value={u.id} defaultChecked={v.recipients.includes(u.id)} />
                    <span className="truncate">{u.full_name}</span>
                    <span className="text-[11px] text-slate-400">{u.role === "company_admin" ? "admin" : u.role.replace("_", " ")}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Send from number" hint="Empty = the Follow-up alerts number, else your first number.">
                <select className="input" name="wa_number_id" defaultValue={v.wa_number_id}>
                  <option value="">Automatic</option>
                  {(numbers ?? []).map((n) => <option key={n.id} value={n.id}>{n.label}{n.display_phone ? ` · ${n.display_phone}` : ""}{n.is_active ? "" : " (inactive)"}</option>)}
                </select>
              </Field>
              <Field label="Template language"><input className="input" name="wa_template_lang" defaultValue={v.wa_template_lang} placeholder="en" /></Field>
            </div>
            <Field label="Approved template name (Cloud API numbers)" hint="Body with 2 variables: {{1}} = name, {{2}} = the summary in one line. Without a template the full summary goes as plain text, which WhatsApp delivers only if the owner messaged this number in the last 24 hours. QR numbers always send plain text.">
              <input className="input" name="wa_template" defaultValue={v.wa_template} placeholder="daily_summary" />
            </Field>
            <Submit>Save</Submit>
          </ActionForm>
        </div>

        <div className="space-y-4">
          <Panel title="Today so far (preview)" icon="chart" tone="green">
            <pre className="whitespace-pre-wrap rounded-lg bg-emerald-50/60 p-3 font-sans text-sm text-navy-900">{text}</pre>
            <div className="mt-3"><SendNow /></div>
          </Panel>
          {v.enabled && noPhone.length > 0 && (
            <Notice>No mobile number for {noPhone.map((u) => u.full_name).join(", ")}. Add it on the Users page to get the summary on WhatsApp.</Notice>
          )}
          {!(numbers ?? []).some((n) => n.is_active) && <Notice>Connect a WhatsApp number first. Until then the summary shows only in the app.</Notice>}
          <Panel title="Template to create in Meta (optional)" icon="template" tone="slate">
            <div className="space-y-1 text-sm text-slate-600">
              <p>Category <b>Utility</b>, name e.g. <code>daily_summary</code>, body:</p>
              <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs">Hi {"{{1}}"}, your Lead Box summary for today: {"{{2}}"}</pre>
            </div>
          </Panel>
          <Panel title="Recent summaries" icon="clock" tone="slate">
            {!log?.length ? <p className="text-sm text-slate-500">Nothing sent yet.</p> : (
              <ul className="divide-y text-sm">
                {log.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-navy-900">{(a.user as unknown as { full_name: string } | null)?.full_name ?? "—"}</div>
                      <div className="text-xs text-slate-500">WhatsApp · {fmtDateTime(a.created_at)}</div>
                      {a.error && a.status === "failed" && <div className="text-xs text-red-600">{a.error}</div>}
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_STYLE[a.status] ?? "bg-slate-100 text-slate-600"}`}>{a.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

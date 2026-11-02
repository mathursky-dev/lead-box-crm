import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/static";
import { ActionForm, Field, Submit } from "@/components/ui";
import { Notice, Panel } from "@/components/kit";
import { PushToggle } from "@/components/push-toggle";
import { saveAlertSettings } from "@/lib/actions/alerts";
import { fmtDateTime } from "@/lib/dates";

export const metadata = { title: "Follow-up alerts" };

const STATUS_STYLE: Record<string, string> = {
  sent: "bg-emerald-50 text-emerald-700", failed: "bg-red-50 text-red-700", queued: "bg-amber-50 text-amber-700", sending: "bg-sky-50 text-sky-700",
};

export default async function AlertsPage() {
  const { profile } = await requireAdmin();
  const sb = await createClient();
  const [{ data: s }, { data: numbers }, { data: log }, { data: users }] = await Promise.all([
    sb.from("lb_alert_settings").select("*").eq("company_id", profile.company_id).maybeSingle(),
    sb.from("lb_wa_numbers").select("id,label,display_phone,is_active").eq("company_id", profile.company_id).order("label"),
    sb.from("lb_alert_queue").select("id,channel,kind,title,status,error,created_at,user:lb_profiles(full_name)")
      .eq("company_id", profile.company_id).order("created_at", { ascending: false }).limit(30),
    sb.from("lb_profiles").select("id,full_name,phone").eq("company_id", profile.company_id).eq("is_active", true).neq("role", "super_admin"),
  ]);
  const v = {
    missed_enabled: s?.missed_enabled ?? true, missed_after_min: s?.missed_after_min ?? 30,
    manager_list_enabled: s?.manager_list_enabled ?? true, manager_list_hour: s?.manager_list_hour ?? 9,
    push_enabled: s?.push_enabled ?? true, wa_enabled: s?.wa_enabled ?? false,
    wa_number_id: s?.wa_number_id ?? "", wa_template: s?.wa_template ?? "", wa_template_lang: s?.wa_template_lang ?? "en",
  };
  const noPhone = (users ?? []).filter((u) => !u.phone?.trim());

  return (
    <>
      <PageHeader icon="alert" tone="amber" title="Follow-up alerts"
        sub="Agents get an alert when a follow-up is missed; admins and team leaders get a daily list of missed follow-ups." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="card p-5">
          <ActionForm action={saveAlertSettings}>
            <h2 className="text-sm font-semibold text-navy-900">Missed follow-up alert (to the agent)</h2>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="missed_enabled" defaultChecked={v.missed_enabled} className="mt-1" />
              <span><b>Alert the agent</b> when a follow-up is still open after its due time.</span></label>
            <Field label="Alert after (minutes past due)" hint="0 = right at the due time. Only follow-ups due in the last 24 hours are alerted.">
              <input className="input w-28" type="number" min={0} max={1440} name="missed_after_min" defaultValue={v.missed_after_min} />
            </Field>

            <h2 className="pt-2 text-sm font-semibold text-navy-900">Daily missed list (to admins & team leaders)</h2>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="manager_list_enabled" defaultChecked={v.manager_list_enabled} className="mt-1" />
              <span><b>Send every morning</b> the count of open follow-ups from earlier days, per agent. Team leaders see their own team.</span></label>
            <Field label="Send at (IST hour, 0–23)"><input className="input w-24" type="number" min={0} max={23} name="manager_list_hour" defaultValue={v.manager_list_hour} /></Field>

            <h2 className="pt-2 text-sm font-semibold text-navy-900">Channels</h2>
            <p className="text-xs text-slate-500">Every alert always shows in the in-app bell.</p>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="push_enabled" defaultChecked={v.push_enabled} className="mt-1" />
              <span><b>Phone / browser push.</b> Each user taps &ldquo;Turn on notifications&rdquo; once on their phone (Follow-ups page). Also pushes new tasks and lead assignments.</span></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="wa_enabled" defaultChecked={v.wa_enabled} className="mt-1" />
              <span><b>WhatsApp</b> to the user&apos;s mobile number (Users page) from a business number.</span></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Send from number">
                <select className="input" name="wa_number_id" defaultValue={v.wa_number_id}>
                  <option value="">Choose…</option>
                  {(numbers ?? []).map((n) => <option key={n.id} value={n.id}>{n.label}{n.display_phone ? ` · ${n.display_phone}` : ""}{n.is_active ? "" : " (inactive)"}</option>)}
                </select>
              </Field>
              <Field label="Template language"><input className="input" name="wa_template_lang" defaultValue={v.wa_template_lang} placeholder="en" /></Field>
            </div>
            <Field label="Approved template name (Cloud API numbers)" hint="Body with 2 variables: {{1}} = name, {{2}} = alert text. Without a template, plain text is sent, which WhatsApp delivers only if the user messaged this number in the last 24 hours. QR numbers always use plain text.">
              <input className="input" name="wa_template" defaultValue={v.wa_template} placeholder="staff_alert" />
            </Field>
            <Submit>Save alert settings</Submit>
          </ActionForm>
        </div>

        <div className="space-y-4">
          <Panel title="This device" icon="phone" tone="blue">
            <PushToggle />
          </Panel>
          {v.wa_enabled && noPhone.length > 0 && (
            <Notice>No mobile number for {noPhone.slice(0, 6).map((u) => u.full_name).join(", ")}{noPhone.length > 6 ? ` +${noPhone.length - 6} more` : ""}. Add it on the Users page to get WhatsApp alerts.</Notice>
          )}
          <Panel title="Template to create in Meta (optional)" icon="template" tone="slate">
            <div className="space-y-1 text-sm text-slate-600">
              <p>Category <b>Utility</b>, name e.g. <code>staff_alert</code>, body:</p>
              <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs">Hi {"{{1}}"}, reminder from Lead Box: {"{{2}}"}</pre>
            </div>
          </Panel>
          <Panel title="Recent alerts" icon="clock" tone="slate">
            {!log?.length ? <p className="text-sm text-slate-500">No alerts sent yet.</p> : (
              <ul className="divide-y text-sm">
                {log.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-navy-900">{a.title}</div>
                      <div className="text-xs text-slate-500">
                        {(a.user as unknown as { full_name: string } | null)?.full_name ?? "—"} · {a.channel === "push" ? "Push" : "WhatsApp"} · {fmtDateTime(a.created_at)}
                      </div>
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

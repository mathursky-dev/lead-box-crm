import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/static";
import { ActionForm, Field, Submit } from "@/components/ui";
import { saveCompanySettings } from "@/lib/actions/admin";
import { saveNurtureSettings } from "@/lib/actions/nurture";
import { saveAutomationSettings } from "@/lib/actions/automation";
import { aiConfigured } from "@/lib/ai";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { profile } = await requireAdmin();
  const { data: c } = await (await createClient()).from("lb_companies").select("*").eq("id", profile.company_id).single();
  return (
    <>
      <PageHeader icon="gear" tone="navy" title="Company settings" sub="Reporting timezone: Asia/Kolkata (IST)." />
      <div className="card max-w-xl p-5">
        <ActionForm action={saveCompanySettings}>
          <Field label="Company name"><input className="input" name="name" defaultValue={c?.name} required /></Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="auto_create_leads" defaultChecked={c?.auto_create_leads} className="mt-1" />
            <span><b>Auto-create leads</b> on the first inbound WhatsApp message from a new contact. Repeat messages always attach to the existing customer/lead.</span></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="auto_allocate" defaultChecked={c?.auto_allocate} className="mt-1" />
            <span><b>Auto-allocate</b> new leads to users by source, ratio and max per day (Allocation tab).</span></label>
          <Submit>Save settings</Submit>
        </ActionForm>
      </div>
      <div className="card mt-4 max-w-xl p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Nurturing & SLA policy</h2>
        <ActionForm action={saveNurtureSettings}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First-response SLA (minutes)" hint="Assignee is alerted when a customer waits longer."><input className="input" type="number" min={1} name="sla_first_response_minutes" defaultValue={c?.sla_first_response_minutes} required /></Field>
            <Field label="Escalate after (minutes)" hint="Team leaders and admins are alerted."><input className="input" type="number" min={2} name="sla_escalation_minutes" defaultValue={c?.sla_escalation_minutes} required /></Field>
            <Field label="Quiet hours start (IST)"><input className="input" type="time" name="quiet_hours_start" defaultValue={c?.quiet_hours_start?.slice(0, 5)} /></Field>
            <Field label="Quiet hours end (IST)"><input className="input" type="time" name="quiet_hours_end" defaultValue={c?.quiet_hours_end?.slice(0, 5)} /></Field>
            <Field label="Max automated messages per customer / 7 days"><input className="input" type="number" min={0} max={50} name="marketing_cap_per_week" defaultValue={c?.marketing_cap_per_week} required /></Field>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="require_next_action" defaultChecked={c?.require_next_action} className="mt-1" />
            <span><b>Require a next action</b> (type + due date) whenever an open lead&apos;s status is changed.</span></label>
          <Submit>Save policy</Submit>
        </ActionForm>
      </div>
      <div className="card mt-4 max-w-xl p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Automation, AI & digests</h2>
        <ActionForm action={saveAutomationSettings}>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="ai_enabled" defaultChecked={c?.ai_enabled} className="mt-1" />
            <span><b>Enable AI summaries & suggested replies.</b> Conversation text is sent to Anthropic&apos;s API. Replies are drafts only and use approved knowledge articles. {aiConfigured() ? "" : <span className="text-amber-700">Server key ANTHROPIC_API_KEY is not set yet.</span>}</span></label>
          <Field label="Complaint keywords (comma-separated)" hint="A match raises a complaint, suppresses marketing and stops journeys."><textarea className="input" name="complaint_keywords" rows={2} defaultValue={(c?.complaint_keywords ?? []).join(", ")} /></Field>
          <Field label="Buying-signal keywords (comma-separated)" hint="A match alerts the owner and can start a journey."><textarea className="input" name="buying_keywords" rows={2} defaultValue={(c?.buying_keywords ?? []).join(", ")} /></Field>
          <Field label="Manager digest hour (IST, 0–23)"><input className="input w-24" type="number" min={0} max={23} name="digest_hour" defaultValue={c?.digest_hour ?? 9} /></Field>
          <Submit>Save automation settings</Submit>
        </ActionForm>
      </div>
    </>
  );
}

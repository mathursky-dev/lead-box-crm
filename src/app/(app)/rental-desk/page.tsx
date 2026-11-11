import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { ActionForm, Field, Submit } from "@/components/ui";
import { Kpi, Notice, Panel, PillTabs, Table } from "@/components/kit";
import { fmtDateTime } from "@/lib/dates";
import { FIELDS, LIVORA_ZONES, fieldsFor, inr, missingFields, type Answers, type Zone } from "@/lib/rental-desk";
import { confirmRentalPayment, markRentalFound, rejectRentalPayment, saveRentalDesk, setRentalZone } from "@/lib/actions/rental-desk";

export const metadata = { title: "Rental desk" };

const STAGE: Record<string, { label: string; cls: string }> = {
  role: { label: "Choosing type", cls: "bg-slate-100 text-slate-600" },
  form: { label: "Filling form", cls: "bg-sky-50 text-sky-700" },
  fee_offer: { label: "₹ offer sent", cls: "bg-amber-50 text-amber-700" },
  awaiting_payment: { label: "QR sent", cls: "bg-amber-50 text-amber-700" },
  payment_review: { label: "Check payment", cls: "bg-red-50 text-red-700" },
  registered: { label: "Registered", cls: "bg-emerald-50 text-emerald-700" },
  not_registered: { label: "Not registered", cls: "bg-slate-100 text-slate-600" },
  fu_ask: { label: "Follow-up sent", cls: "bg-violet-50 text-violet-700" },
  fu_broker: { label: "Flat found: asking", cls: "bg-violet-50 text-violet-700" },
  fu_rent: { label: "Flat found: asking", cls: "bg-violet-50 text-violet-700" },
  fu_happy: { label: "Flat found: asking", cls: "bg-violet-50 text-violet-700" },
  details: { label: "Owner/Broker/Buyer", cls: "bg-slate-100 text-slate-600" },
  done: { label: "Owner/Broker/Buyer", cls: "bg-slate-100 text-slate-600" },
  closed: { label: "Flat final", cls: "bg-emerald-100 text-emerald-800" },
};

const TABS: { key: string; label: string; stages: string[] }[] = [
  { key: "check", label: "Check payment", stages: ["payment_review"] },
  { key: "open", label: "In progress", stages: ["role", "form", "fee_offer", "awaiting_payment"] },
  { key: "registered", label: "Registered", stages: ["registered", "fu_ask", "fu_broker", "fu_rent", "fu_happy"] },
  { key: "unreg", label: "Not registered", stages: ["not_registered"] },
  { key: "closed", label: "Flat final", stages: ["closed"] },
  { key: "others", label: "Owner / Broker / Buyer", stages: ["details", "done"] },
];

type Enq = {
  id: string; stage: string; role: string | null; answers: Answers; zone: number | null; budget: number | null; conversation_id: string; lead_id: string | null;
  screenshot_message_id: string | null; screenshot_at: string | null; paid_at: string | null; followups: number; next_followup_at: string | null;
  found_broker: string | null; found_rent: string | null; happy: string | null; updated_at: string; created_at: string;
  customer: { name: string | null; wa_profile_name: string | null; phone_e164: string } | null; assigned: { full_name: string } | null;
};

export default async function RentalDeskPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { profile } = await requireAdmin();
  const sp = await searchParams;
  const sb = await createClient();
  const [{ data: desk, error: dErr }, { data: users }, { data: rows, error }] = await Promise.all([
    sb.from("lb_rental_desk").select("*").eq("company_id", profile.company_id).maybeSingle(),
    sb.from("lb_profiles").select("id,full_name,role").eq("company_id", profile.company_id).eq("is_active", true).neq("role", "super_admin").order("full_name"),
    sb.from("lb_rental_enquiries").select("id,stage,role,answers,zone,budget,conversation_id,lead_id,screenshot_message_id,screenshot_at,paid_at,followups,next_followup_at,found_broker,found_rent,happy,updated_at,created_at,customer:lb_customers(name,wa_profile_name,phone_e164),assigned:lb_profiles!lb_rental_enquiries_assigned_to_fkey(full_name)")
      .eq("company_id", profile.company_id).order("updated_at", { ascending: false }).limit(500),
  ]);
  if (dErr || error) return <ErrorBox message={(dErr ?? error)!.message} />;
  const zones: Zone[] = Array.isArray(desk?.zones) && desk.zones.length ? desk.zones : LIVORA_ZONES.map((z) => ({ ...z, user_id: null }));
  const all = (rows ?? []) as unknown as Enq[];
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const count = (k: string) => all.filter((e) => TABS.find((t) => t.key === k)!.stages.includes(e.stage)).length;
  const list = all.filter((e) => tab.stages.includes(e.stage));
  const zoneLabel = (n: number | null) => (n ? `Zone ${n}` : "No zone");
  const userName = (id: string | null) => users?.find((u) => u.id === id)?.full_name;

  return (
    <>
      <PageHeader icon="building" tone="green" title="Rental desk"
        sub="WhatsApp enquiries: who is writing, the 20-point tenant form, ₹ registration, zone-wise lead and daily follow-ups." />
      {!desk?.enabled && <Notice>The Rental desk is <b>off</b>. Set the zone users below and tick “Rental desk is on” to start answering WhatsApp enquiries.</Notice>}
      {desk?.enabled && zones.some((z) => !z.user_id) && <Notice>Zones without a user: {zones.filter((z) => !z.user_id).map((z) => `Zone ${z.no}`).join(", ")}. Payments for those zones can’t be confirmed until a user is set.</Notice>}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Check payment" value={count("check")} icon="rupee" tone="red" href="/rental-desk?tab=check" />
        <Kpi label="In progress" value={count("open")} icon="clock" tone="amber" href="/rental-desk?tab=open" />
        <Kpi label="Registered" value={count("registered")} icon="check" tone="green" href="/rental-desk?tab=registered" />
        <Kpi label="Flat final" value={count("closed")} icon="trophy" tone="violet" href="/rental-desk?tab=closed" />
      </div>

      <PillTabs label="Enquiries" tabs={TABS.map((t) => ({ href: `/rental-desk?tab=${t.key}`, label: t.label, active: t.key === tab.key, count: count(t.key) }))} />

      <div className="card mt-3 mb-6">
        <Table head={["Customer", "Requirement", "Zone", "Status", "Action"]} empty={list.length ? undefined : "Nothing here right now."}>
          {list.map((e) => {
            const c = e.customer;
            const miss = e.role === "tenant" ? missingFields(e.answers ?? {}).length : 0;
            const s = STAGE[e.stage] ?? { label: e.stage, cls: "bg-slate-100" };
            return (
              <tr key={e.id} className="align-top">
                <td className="td">
                  <Link className="font-medium text-brand-700 hover:underline" href={`/inbox?c=${e.conversation_id}`}>{c?.name || c?.wa_profile_name || c?.phone_e164 || "—"}</Link>
                  <div className="text-xs text-slate-500">{c?.phone_e164}</div>
                  <div className="text-[11px] text-slate-400">{fmtDateTime(e.updated_at)}</div>
                  {e.lead_id && <Link className="text-[11px] text-brand-700 hover:underline" href={`/leads/${e.lead_id}`}>Open lead</Link>}
                </td>
                <td className="td max-w-xs text-xs text-slate-600">
                  {e.role && e.role !== "tenant" && <div className="font-semibold capitalize">{e.role}</div>}
                  {e.role === "buyer" && (
                    <>
                      <div>{[e.answers?.b_bhk, e.answers?.b_budget, e.answers?.b_area].filter(Boolean).join(" · ") || "—"}</div>
                      {e.stage === "form" && <div className="text-amber-700">{missingFields(e.answers ?? {}, fieldsFor("buyer")).length} of {fieldsFor("buyer").length} details missing</div>}
                      <details className="mt-1"><summary className="cursor-pointer text-brand-700">Full form</summary>
                        <ol className="mt-1 list-decimal space-y-0.5 pl-4">{fieldsFor("buyer").map((f) => <li key={f.key}><span className="text-slate-400">{f.label}:</span> {e.answers?.[f.key] ?? "—"}</li>)}</ol>
                      </details>
                    </>
                  )}
                  {e.role === "tenant" && (
                    <>
                      <div>{[e.answers?.bhk, e.budget ? `${inr(e.budget)}/mo` : e.answers?.budget, e.answers?.furnishing].filter(Boolean).join(" · ") || "—"}</div>
                      <div className="truncate">📍 {e.answers?.area ?? "—"}</div>
                      {e.stage === "form" && <div className="text-amber-700">{miss} of {FIELDS.length} details missing</div>}
                      <details className="mt-1"><summary className="cursor-pointer text-brand-700">Full form</summary>
                        <ol className="mt-1 list-decimal space-y-0.5 pl-4">{FIELDS.map((f) => <li key={f.key}><span className="text-slate-400">{f.label}:</span> {e.answers?.[f.key] ?? "—"}</li>)}</ol>
                      </details>
                    </>
                  )}
                  {e.stage === "closed" && <div className="mt-1 text-emerald-700">Given by {e.found_broker ?? "—"} · Rent {e.found_rent ?? "—"} · Happy {e.happy ?? "—"}</div>}
                </td>
                <td className="td text-xs">
                  {e.role === "tenant" ? (
                    <ActionForm action={setRentalZone} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={e.id} />
                      <select name="zone" defaultValue={e.zone ?? ""} className="input h-8 w-28 py-0 text-xs">
                        <option value="">No zone</option>
                        {zones.map((z) => <option key={z.no} value={z.no}>Zone {z.no}</option>)}
                      </select>
                      <Submit className="btn-secondary btn-sm" pendingText="…">Set</Submit>
                    </ActionForm>
                  ) : "—"}
                  <div className="mt-1 text-slate-500">{e.assigned?.full_name ?? (e.zone ? userName(zones.find((z) => z.no === e.zone)?.user_id ?? null) ?? "" : "")}</div>
                </td>
                <td className="td text-xs">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.label}</span>
                  {e.paid_at && <div className="mt-1 text-slate-500">Paid {fmtDateTime(e.paid_at)}</div>}
                  {e.followups > 0 && <div className="text-slate-500">{e.followups} follow-up{e.followups === 1 ? "" : "s"}</div>}
                  {e.next_followup_at && <div className="text-slate-400">Next {fmtDateTime(e.next_followup_at)}</div>}
                </td>
                <td className="td space-y-2 text-xs">
                  {e.screenshot_message_id && (
                    <a className="btn-secondary btn-sm inline-block" href={`/api/media/${e.screenshot_message_id}`} target="_blank" rel="noreferrer">View screenshot</a>
                  )}
                  {["payment_review", "awaiting_payment", "fee_offer", "not_registered"].includes(e.stage) && e.role === "tenant" && (
                    <ActionForm action={confirmRentalPayment} className="flex items-center gap-1" confirm={`Confirm ${inr(desk?.fee ?? 200)} payment and give this lead to ${zoneLabel(e.zone)}?`}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="zone" value={e.zone ?? ""} />
                      <Submit className="btn-primary btn-sm" pendingText="Confirming…">Payment confirm</Submit>
                    </ActionForm>
                  )}
                  {e.stage === "payment_review" && (
                    <ActionForm action={rejectRentalPayment} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={e.id} />
                      <input name="reason" className="input h-8 w-32 py-0 text-xs" placeholder="Reason (optional)" />
                      <Submit className="btn-secondary btn-sm" pendingText="…">Not received</Submit>
                    </ActionForm>
                  )}
                  {e.stage !== "closed" && e.role === "tenant" && ["registered", "fu_ask", "fu_broker", "fu_rent", "fu_happy", "not_registered"].includes(e.stage) && (
                    <details><summary className="cursor-pointer text-brand-700">Flat found?</summary>
                      <ActionForm action={markRentalFound} className="mt-1 space-y-1">
                        <input type="hidden" name="id" value={e.id} />
                        <input name="broker" className="input h-8 text-xs" placeholder="Who gave the flat" />
                        <input name="rent" className="input h-8 text-xs" placeholder="Final rent" />
                        <Submit className="btn-primary btn-sm" pendingText="…">Save</Submit>
                      </ActionForm>
                    </details>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </div>

      <Panel title="Settings" icon="gear" tone="slate" sub="Zone users, ₹ fee, UPI QR, personal number for “flat final” alerts and follow-up templates.">
        <ActionForm action={saveRentalDesk} className="space-y-4">
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={desk?.enabled ?? false} className="mt-1" />
            <span><b>Rental desk is on.</b> Every new WhatsApp chat gets “Aap kaun hain?” (Tenant / Owner / Broker / Buyer). Other chatbot flows don’t start while it is on.</span></label>

          <div className="grid gap-3 md:grid-cols-2">
            {zones.map((z) => (
              <div key={z.no} className="rounded-lg border border-slate-200 p-3">
                <Field label={`Zone ${z.no}: ${z.name}`}>
                  <select className="input" name={`zone_user_${z.no}`} defaultValue={z.user_id ?? ""}>
                    <option value="">No user yet</option>
                    {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                </Field>
                <details className="mt-2"><summary className="cursor-pointer text-xs text-brand-700">Areas in this zone ({z.areas.length})</summary>
                  <textarea name={`zone_areas_${z.no}`} rows={4} className="input mt-1 text-xs" defaultValue={z.areas.join(", ")} />
                </details>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Registration fee (₹)"><input className="input" name="fee" type="number" min={1} defaultValue={desk?.fee ?? 200} /></Field>
            <Field label="UPI ID"><input className="input" name="upi_id" defaultValue={desk?.upi_id ?? ""} placeholder="name@ybl" /></Field>
            <Field label="UPI name"><input className="input" name="upi_name" defaultValue={desk?.upi_name ?? ""} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="UPI QR photo" hint="Sent to the customer on WhatsApp. Upload a new one to replace it.">
              <input type="file" name="qr_file" accept="image/png,image/jpeg" className="input" />
            </Field>
            <Field label="…or QR image link (https)"><input className="input" name="qr_url" defaultValue={desk?.qr_url ?? ""} /></Field>
          </div>
          {desk?.qr_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={desk.qr_url} alt="UPI QR" className="h-40 rounded border" />
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Personal number for “flat final”" hint="Gets a WhatsApp when a registered client confirms the flat."><input className="input" name="alert_phone" defaultValue={desk?.alert_phone ?? ""} placeholder="+91…" /></Field>
            <Field label="Alert template (optional)" hint="Body: {{1}} name, {{2}} details. Needed when that number hasn’t messaged in 24 hours."><input className="input" name="alert_template" defaultValue={desk?.alert_template ?? ""} /></Field>
            <Field label="Alert template language"><input className="input" name="alert_template_lang" defaultValue={desk?.alert_template_lang ?? "en"} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Follow-up template" hint="Used when the customer hasn’t written in 24 hours. Body: {{1}} = name; quick-reply buttons “Haan, mil gaya” and “Abhi nahi”.">
              <input className="input" name="followup_template" defaultValue={desk?.followup_template ?? ""} placeholder="flat_followup" />
            </Field>
            <Field label="Follow-up template language"><input className="input" name="followup_template_lang" defaultValue={desk?.followup_template_lang ?? "en"} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Follow up every (hours)"><input className="input" name="followup_hours" type="number" min={6} max={168} defaultValue={desk?.followup_hours ?? 24} /></Field>
            <Field label="Max follow-ups (registered)"><input className="input" name="max_followups" type="number" min={0} defaultValue={desk?.max_followups ?? 30} /></Field>
            <Field label="Max follow-ups (not registered)"><input className="input" name="max_followups_unreg" type="number" min={0} defaultValue={desk?.max_followups_unreg ?? 15} /></Field>
            <Field label="Not registered: follow up only if budget ≥ (₹)"><input className="input" name="min_followup_budget" type="number" min={0} defaultValue={desk?.min_followup_budget ?? 20000} /></Field>
          </div>
          <Submit>Save</Submit>
        </ActionForm>
      </Panel>
    </>
  );
}

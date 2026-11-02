"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, Field, ModalButton, Submit } from "@/components/ui";
import { RENEWAL_KINDS, TICKET_PRIORITIES, TICKET_STATUSES, type RetentionSettings } from "@/lib/retention";
import {
  addTicketComment, adjustPoints, redeemPoints, renewalAction, saveCustomerDates, saveRenewal, saveRetentionSettings, saveTicket, setTicketStatus,
} from "@/lib/actions/retention";

type User = { id: string; name: string };
/** Who the new record is for: a lead (from the lead page), a known customer, or a phone number typed in. */
type Target = { leadId?: string; customerId?: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const run = (fn: () => Promise<{ error?: string } | undefined>) => start(async () => {
    const r = await fn();
    setError(r?.error);
    if (!r?.error) router.refresh();
  });
  return { pending, error, run };
}

const TargetFields = ({ t }: { t: Target }) => (
  <>
    {t.leadId && <input type="hidden" name="lead_id" value={t.leadId} />}
    {t.customerId && <input type="hidden" name="customer_id" value={t.customerId} />}
    {!t.leadId && !t.customerId && (
      <Field label="Customer mobile" hint="The customer must already be in the CRM">
        <input className="input" name="phone" required inputMode="tel" placeholder="98xxxxxxxx" />
      </Field>
    )}
  </>
);

// ---------------------------------------------------------------- tickets
export type TicketEdit = { id: string; subject: string; description: string | null; category: string | null; priority: string; assigned_to: string | null };

export function TicketForm({ target, categories, users, edit, onOk }: { target: Target; categories: string[]; users: User[]; edit?: TicketEdit; onOk?: () => void }) {
  return (
    <ActionForm action={saveTicket} onOk={onOk} resetOnOk={!edit}>
      {edit ? <input type="hidden" name="id" value={edit.id} /> : <TargetFields t={target} />}
      <Field label="Subject"><input className="input" name="subject" required maxLength={200} defaultValue={edit?.subject} placeholder="AC not cooling / wrong item delivered" /></Field>
      <Field label="Details"><textarea className="input" name="description" rows={3} maxLength={4000} defaultValue={edit?.description ?? ""} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Category">
          <select className="input" name="category" defaultValue={edit?.category ?? ""}>
            <option value="">—</option>
            {[...new Set([...categories, ...(edit?.category ? [edit.category] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className="input" name="priority" defaultValue={edit?.priority ?? "normal"}>
            {TICKET_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Assign to">
          <select className="input" name="assigned_to" defaultValue={edit ? edit.assigned_to ?? "" : ""}>
            <option value="">{edit ? "Nobody" : "Lead owner (auto)"}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
      </div>
      <Submit>{edit ? "Save ticket" : "Create ticket"}</Submit>
    </ActionForm>
  );
}

export function NewTicketButton({ target, categories, users, className = "btn-primary btn-sm", label = "+ New ticket" }: { target: Target; categories: string[]; users: User[]; className?: string; label?: string }) {
  return (
    <ModalButton label={label} title="New service ticket" className={className} wide>
      {(close) => <TicketForm target={target} categories={categories} users={users} onOk={close} />}
    </ModalButton>
  );
}

export function EditTicketButton({ edit, categories, users }: { edit: TicketEdit; categories: string[]; users: User[] }) {
  return (
    <ModalButton label="Edit" title="Edit ticket" className="btn-ghost btn-sm" wide>
      {(close) => <TicketForm target={{}} edit={edit} categories={categories} users={users} onOk={close} />}
    </ModalButton>
  );
}

export function TicketStatus({ id, status }: { id: string; status: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-col gap-0.5">
      <select className="input !w-auto !py-1 text-xs" value={status} disabled={pending} aria-label="Ticket status"
        onChange={(e) => {
          const v = e.target.value;
          const note = v === "resolved" || v === "closed" ? window.prompt("Resolution (what was done)?", "") : "";
          if (note === null) return;
          run(() => setTicketStatus(id, v, note || undefined));
        }}>
        {TICKET_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function TicketReply({ id, canSend, hasLead }: { id: string; canSend: boolean; hasLead: boolean }) {
  const [internal, setInternal] = useState(false);
  return (
    <ActionForm action={addTicketComment} resetOnOk className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <textarea className="input" name="body" rows={3} required maxLength={4000} placeholder={internal ? "Internal note (customer can't see it)" : "Reply to the customer (shown on their portal)"} />
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="internal" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note</label>
        {canSend && hasLead && !internal && <label className="flex items-center gap-2"><input type="checkbox" name="send" /> Also send on WhatsApp</label>}
        <span className="ml-auto"><Submit className="btn-primary btn-sm">{internal ? "Add note" : "Reply"}</Submit></span>
      </div>
    </ActionForm>
  );
}

// --------------------------------------------------------------- renewals
export type RenewalEdit = { id: string; title: string; kind: string; start_date: string | null; due_date: string; repeat_months: number | null; amount: number | null; assigned_to: string | null; notes: string | null; product_id: string | null };

export function RenewalForm({ target, users, products, edit, onOk }: { target: Target; users: User[]; products: { id: string; name: string }[]; edit?: RenewalEdit; onOk?: () => void }) {
  return (
    <ActionForm action={saveRenewal} onOk={onOk} resetOnOk={!edit}>
      {edit ? <input type="hidden" name="id" value={edit.id} /> : <TargetFields t={target} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title"><input className="input" name="title" required maxLength={160} defaultValue={edit?.title} placeholder="RO purifier AMC" /></Field>
        <Field label="Type">
          <select className="input" name="kind" defaultValue={edit?.kind ?? "amc"}>
            {RENEWAL_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="Start date"><input className="input" type="date" name="start_date" defaultValue={edit?.start_date ?? ""} /></Field>
        <Field label="Due / expiry date"><input className="input" type="date" name="due_date" required defaultValue={edit?.due_date ?? ""} /></Field>
        <Field label="Repeats every (months)" hint="Empty = one time. 12 = yearly AMC"><input className="input" name="repeat_months" inputMode="numeric" pattern="\d{0,3}" defaultValue={edit?.repeat_months ?? (edit ? "" : "12")} /></Field>
        <Field label="Renewal amount (₹)"><input className="input" name="amount" inputMode="decimal" defaultValue={edit?.amount ?? ""} placeholder="2500" /></Field>
        <Field label="Owner">
          <select className="input" name="assigned_to" defaultValue={edit ? edit.assigned_to ?? "" : ""}>
            <option value="">{edit ? "Nobody" : "Lead owner (auto)"}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        {products.length > 0 && (
          <Field label="Product">
            <select className="input" name="product_id" defaultValue={edit?.product_id ?? ""}>
              <option value="">{edit ? "—" : "Lead's product (auto)"}</option>
              {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        )}
      </div>
      <Field label="Notes"><textarea className="input" name="notes" rows={2} maxLength={2000} defaultValue={edit?.notes ?? ""} /></Field>
      <Submit>{edit ? "Save" : "Add renewal"}</Submit>
    </ActionForm>
  );
}

export function NewRenewalButton({ target, users, products, className = "btn-primary btn-sm", label = "+ Add renewal" }: { target: Target; users: User[]; products: { id: string; name: string }[]; className?: string; label?: string }) {
  return (
    <ModalButton label={label} title="Add AMC / renewal" className={className} wide>
      {(close) => <RenewalForm target={target} users={users} products={products} onOk={close} />}
    </ModalButton>
  );
}

export function EditRenewalButton({ edit, users, products }: { edit: RenewalEdit; users: User[]; products: { id: string; name: string }[] }) {
  return (
    <ModalButton label="Edit" title="Edit renewal" className="btn-ghost btn-sm" wide>
      {(close) => <RenewalForm target={{}} edit={edit} users={users} products={products} onOk={close} />}
    </ModalButton>
  );
}

export function RenewalActions({ id, status, amount }: { id: string; status: string; amount: number | null }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="flex flex-wrap gap-1.5">
        {(status === "active" || status === "lapsed") && (
          <button type="button" className="btn-primary btn-sm" disabled={pending}
            onClick={() => {
              const a = window.prompt("Renewed! Amount received (₹)?", amount != null ? String(amount) : "");
              if (a === null) return;
              const n = a.trim() ? Number(a.replace(/[,₹\s]/g, "")) : null;
              if (n != null && (!Number.isFinite(n) || n < 0)) { window.alert("Enter a valid amount"); return; }
              run(() => renewalAction(id, "renewed", undefined, n));
            }}>Mark renewed</button>
        )}
        {status !== "cancelled" && status !== "renewed" && (
          <button type="button" className="btn-ghost btn-sm" disabled={pending}
            onClick={() => { const r = window.prompt("Why is it cancelled? (optional)", ""); if (r !== null) run(() => renewalAction(id, "cancel", r)); }}>Cancel</button>
        )}
        {(status === "cancelled" || status === "renewed") && (
          <button type="button" className="btn-ghost btn-sm" disabled={pending} onClick={() => run(() => renewalAction(id, "reactivate"))}>Reactivate</button>
        )}
      </span>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

// ---------------------------------------------------------------- loyalty
export function RedeemButton({ customerId, leadId, balance, pointValue, minRedeem, maxPct, className = "btn-primary btn-sm" }: {
  customerId: string; leadId?: string; balance: number; pointValue: number; minRedeem: number; maxPct: number; className?: string;
}) {
  const [pts, setPts] = useState("");
  const disc = Number(pts) > 0 ? Math.round(Number(pts) * pointValue * 100) / 100 : 0;
  return (
    <ModalButton label="Redeem" title="Redeem points as discount" className={className}>
      {(close) => (
        <ActionForm action={redeemPoints} onOk={close}>
          <input type="hidden" name="customer_id" value={customerId} />
          {leadId && <input type="hidden" name="lead_id" value={leadId} />}
          <p className="text-sm text-slate-600">Balance <b>{balance}</b> points · 1 point = ₹{pointValue} · minimum {minRedeem} · up to {maxPct}% of the bill.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bill amount (₹)"><input className="input" name="bill" required inputMode="decimal" /></Field>
            <Field label="Points to redeem" hint={disc ? `= ₹${disc.toLocaleString("en-IN")} discount` : undefined}>
              <input className="input" name="points" required inputMode="numeric" value={pts} onChange={(e) => setPts(e.target.value.replace(/\D/g, ""))} max={balance} />
            </Field>
          </div>
          <Field label="Note"><input className="input" name="note" maxLength={300} placeholder="Invoice no. / order" /></Field>
          <Submit>Redeem</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

export function AdjustButton({ customerId, leadId, className = "btn-ghost btn-sm", label = "Adjust" }: { customerId?: string; leadId?: string; className?: string; label?: string }) {
  return (
    <ModalButton label={label} title="Add or remove points" className={className}>
      {(close) => (
        <ActionForm action={adjustPoints} onOk={close}>
          {customerId ? <input type="hidden" name="customer_id" value={customerId} /> : (
            <Field label="Customer mobile"><input className="input" name="phone" required inputMode="tel" /></Field>
          )}
          {leadId && <input type="hidden" name="lead_id" value={leadId} />}
          <Field label="Points" hint="Use a minus sign to remove, e.g. -50"><input className="input" name="points" required inputMode="numeric" pattern="-?\d+" /></Field>
          <Field label="Reason"><input className="input" name="note" required maxLength={300} placeholder="Goodwill for late delivery" /></Field>
          <Submit>Save</Submit>
        </ActionForm>
      )}
    </ModalButton>
  );
}

// ------------------------------------------------------- customer dates
export function CustomerDatesForm({ customerId, leadId, birthday, anniversary, onOk }: { customerId: string; leadId?: string; birthday: string | null; anniversary: string | null; onOk?: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm action={saveCustomerDates} onOk={onOk}>
      <input type="hidden" name="customer_id" value={customerId} />
      {leadId && <input type="hidden" name="lead_id" value={leadId} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Birthday" hint="Year unknown? Pick any year"><input className="input" type="date" name="birthday" max={today} defaultValue={birthday ?? ""} /></Field>
        <Field label="Anniversary"><input className="input" type="date" name="anniversary" max={today} defaultValue={anniversary ?? ""} /></Field>
      </div>
      <Submit>Save dates</Submit>
    </ActionForm>
  );
}

export function EditDatesButton(p: { customerId: string; leadId?: string; birthday: string | null; anniversary: string | null }) {
  return (
    <ModalButton label="Edit" title="Birthday & anniversary" className="btn-ghost btn-sm">
      {(close) => <CustomerDatesForm {...p} onOk={close} />}
    </ModalButton>
  );
}

// --------------------------------------------------------------- settings
const Check = ({ name, label, defaultChecked }: { name: string; label: React.ReactNode; defaultChecked: boolean }) => (
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5" /> <span>{label}</span></label>
);
const Card = ({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) => (
  <div className="card max-w-3xl p-5">
    <h2 className="text-base font-semibold text-navy-900">{title}</h2>
    <p className="mb-4 text-sm text-slate-500">{sub}</p>
    {children}
  </div>
);
type Num = { id: string; label: string };
type Tpl = { name: string; language: string; category: string | null };

function TemplatePick({ prefix, numbers, templates, number, name, lang, numberField, label }: {
  prefix: string; numbers: Num[]; templates: Tpl[]; number: string | null; name: string | null; lang: string | null; numberField?: string; label: string;
}) {
  const [val, setVal] = useState(name && lang ? `${name}|${lang}` : "");
  const [n, l] = val ? val.split("|") : ["", ""];
  return (
    <>
      {numberField && (
        <Field label="WhatsApp number">
          <select className="input" name={numberField} defaultValue={number ?? ""}>
            <option value="">—</option>
            {numbers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </Field>
      )}
      <Field label={label}>
        <select className="input" value={val} onChange={(e) => setVal(e.target.value)}>
          <option value="">— none —</option>
          {name && lang && !templates.some((t) => t.name === name && t.language === lang) && <option value={`${name}|${lang}`}>{name} ({lang}) · not approved</option>}
          {templates.map((t) => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}){t.category ? ` · ${t.category.toLowerCase()}` : ""}</option>)}
        </select>
        <input type="hidden" name={`${prefix}_template`} value={n} />
        <input type="hidden" name={`${prefix}_template_lang`} value={l} />
      </Field>
    </>
  );
}

export function RetentionSettingsForms({ s, numbers, templates }: { s: RetentionSettings; numbers: Num[]; templates: Tpl[] }) {
  const P = ["urgent", "high", "normal", "low"] as const;
  return (
    <div className="space-y-4">
      <Card title="Loyalty points" sub="Customers earn points on every purchase (lead Won / store order delivered) and use them as a discount next time. Points show on their portal.">
        <ActionForm action={saveRetentionSettings} className="space-y-4">
          <input type="hidden" name="section" value="loyalty" />
          <Check name="loyalty_enabled" defaultChecked={s.loyalty_enabled} label={<>Loyalty points are <b>on</b></>} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Points per ₹100 spent"><input className="input" name="points_per_100" inputMode="decimal" defaultValue={s.points_per_100} /></Field>
            <Field label="Value of 1 point (₹)"><input className="input" name="point_value" inputMode="decimal" defaultValue={s.point_value} /></Field>
            <Field label="Minimum points to redeem"><input className="input" name="min_redeem" type="number" min={0} defaultValue={s.min_redeem} /></Field>
            <Field label="Max % of a bill paid by points"><input className="input" name="max_redeem_pct" type="number" min={1} max={100} defaultValue={s.max_redeem_pct} /></Field>
            <Field label="Points expire after (months)" hint="Without any purchase. Empty = never"><input className="input" name="expiry_months" type="number" min={1} max={120} defaultValue={s.expiry_months ?? ""} /></Field>
            <Field label="Birthday bonus points"><input className="input" name="birthday_points" type="number" min={0} defaultValue={s.birthday_points} /></Field>
          </div>
          <Check name="earn_on_won" defaultChecked={s.earn_on_won} label="Earn on Won leads (on the won value)" />
          <Check name="earn_on_orders" defaultChecked={s.earn_on_orders} label="Earn on store orders when delivered" />
          <p className="text-xs text-slate-500">Example: ₹10,000 purchase × {s.points_per_100} = {Math.floor(100 * s.points_per_100)} points = ₹{Math.floor(100 * s.points_per_100) * s.point_value} off next time.</p>
          <Submit>Save loyalty settings</Submit>
        </ActionForm>
      </Card>

      <Card title="Service tickets & SLA" sub="After-sales complaints and service requests with a response and resolution deadline by priority. Late tickets alert the owner and admins.">
        <ActionForm action={saveRetentionSettings} className="space-y-4">
          <input type="hidden" name="section" value="tickets" />
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="pr-3">Priority</th><th className="pr-3">First response (hours)</th><th>Resolve within (hours)</th></tr></thead>
              <tbody>
                {P.map((p) => (
                  <tr key={p}>
                    <td className="py-1 pr-3 capitalize">{p}</td>
                    <td className="py-1 pr-3"><input className="input !w-28 !py-1" name={`resp_${p}`} inputMode="decimal" defaultValue={s.sla_response_hours?.[p] ?? ""} aria-label={`${p} response hours`} /></td>
                    <td className="py-1"><input className="input !w-28 !py-1" name={`res_${p}`} inputMode="decimal" defaultValue={s.sla_resolve_hours?.[p] ?? ""} aria-label={`${p} resolve hours`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-slate-500">Clock hours. 0 = no deadline.</p>
          </div>
          <Field label="Categories" hint="Separated by commas"><input className="input" name="ticket_categories" defaultValue={s.ticket_categories.join(", ")} /></Field>
          <Field label="Close resolved tickets after (days)" hint="0 = never"><input className="input !w-28" name="auto_close_days" type="number" min={0} max={90} defaultValue={s.auto_close_days} /></Field>
          <Check name="tickets_from_complaints" defaultChecked={s.tickets_from_complaints} label="Open a ticket automatically when a WhatsApp complaint is detected in the inbox" />
          <Check name="portal_tickets" defaultChecked={s.portal_tickets} label="Customers can raise complaints and reply from their portal link" />
          <Check name="ticket_wa_updates" defaultChecked={s.ticket_wa_updates} label={<>Send the customer a WhatsApp message when a ticket is opened / resolved <span className="text-slate-500">(only inside the 24-hour WhatsApp window)</span></>} />
          <Submit>Save ticket settings</Submit>
        </ActionForm>
      </Card>

      <Card title="AMC / renewal reminders" sub="Before a renewal is due, the owner gets a follow-up (call) on the lead and a notification. Optionally the customer gets a WhatsApp template too.">
        <ActionForm action={saveRetentionSettings} className="space-y-4">
          <input type="hidden" name="section" value="renewals" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Remind days before due" hint="Comma separated, 0 = on the due date"><input className="input" name="renewal_remind_days" defaultValue={s.renewal_remind_days.join(", ")} /></Field>
            <Field label="Mark lapsed after due (days)"><input className="input" name="renewal_lapse_days" type="number" min={0} max={365} defaultValue={s.renewal_lapse_days} /></Field>
          </div>
          <Check name="renewal_auto_wa" defaultChecked={s.renewal_auto_wa} label={<>Send the customer a WhatsApp reminder <b>automatically</b> <span className="text-slate-500">(needs WhatsApp consent and an approved template)</span></>} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TemplatePick prefix="renewal" numberField="renewal_number_id" numbers={numbers} templates={templates} number={s.renewal_number_id} name={s.renewal_template} lang={s.renewal_template_lang} label="Template (Utility)" />
          </div>
          <p className="text-xs text-slate-500">Template variables: {"{{1}}"} name · {"{{2}}"} renewal title · {"{{3}}"} due date · {"{{4}}"} company · {"{{5}}"} amount.</p>
          <Submit>Save renewal settings</Submit>
        </ActionForm>
      </Card>

      <Card title="Birthday & anniversary wishes" sub="Every morning the owner gets the list of customers to wish. Optionally a WhatsApp template wish goes out automatically.">
        <ActionForm action={saveRetentionSettings} className="space-y-4">
          <input type="hidden" name="section" value="wishes" />
          <Check name="wish_notify_owner" defaultChecked={s.wish_notify_owner} label="Remind the lead owner every day (notification)" />
          <Check name="wishes_enabled" defaultChecked={s.wishes_enabled} label={<>Send wishes on WhatsApp <b>automatically</b> <span className="text-slate-500">(needs WhatsApp consent and an approved template)</span></>} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Time (company time zone)">
              <select className="input" name="wish_hour" defaultValue={s.wish_hour}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>)}
              </select>
            </Field>
            <TemplatePick prefix="birthday" numberField="wish_number_id" numbers={numbers} templates={templates} number={s.wish_number_id} name={s.birthday_template} lang={s.birthday_template_lang} label="Birthday template" />
            <TemplatePick prefix="anniversary" numbers={numbers} templates={templates} number={null} name={s.anniversary_template} lang={s.anniversary_template_lang} label="Anniversary template" />
          </div>
          <p className="text-xs text-slate-500">Template variables: {"{{1}}"} name · {"{{2}}"} company. Add birthdays and anniversaries on the lead page (Loyalty & service panel).</p>
          <Submit>Save wishes settings</Submit>
        </ActionForm>
      </Card>
    </div>
  );
}

"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionForm, ActionButton, Field, Submit } from "@/components/ui";
import { assignLeads, updateLead, addFollowup, completeFollowup, logActivity, startConversation } from "@/lib/actions/leads";
import { fmtDateTime, toLocalInput } from "@/lib/dates";
import { changeStatusWithAction, setPayment, enrollLead, enrollmentAction } from "@/lib/actions/nurture";
import type { Refs, StatusOpt } from "@/lib/data";

export function StatusPanel({ leadId, statusId, statuses, expected, nextAction }: {
  leadId: string; statusId: string; statuses: StatusOpt[]; expected: number | null;
  nextAction: { note: string | null; due_at: string; action_type: string } | null;
}) {
  const [sel, setSel] = useState(statusId);
  const cat = statuses.find((s) => s.id === sel)?.category;
  const closed = cat === "won" || cat === "lost" || cat === "invalid";
  return (
    <section id="next-action" className="card p-4">
      <h2 className="mb-1 text-sm font-semibold text-navy-900">Sales status & next action</h2>
      <p className="mb-3 text-xs text-slate-500">
        {nextAction ? <>Next action: <b className="capitalize">{nextAction.action_type}</b> — {nextAction.note ?? "follow up"} · due {fmtDateTime(nextAction.due_at)}</>
          : <span className="font-medium text-amber-700">No next action scheduled. Open leads must have one.</span>}
      </p>
      <ActionForm action={changeStatusWithAction} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="id" value={leadId} />
        <Field label="Status">
          <select className="input" name="status_id" value={sel} onChange={(e) => setSel(e.target.value)}>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        {cat === "won" && <Field label="Won value (₹)"><input className="input" type="number" min={0} step="0.01" name="won_value" defaultValue={expected ?? ""} /></Field>}
        {(cat === "lost" || cat === "invalid") && <Field label="Reason (required)"><input className="input" name="reason" required /></Field>}
        {!closed && <Field label="Comment (optional)"><input className="input" name="reason" /></Field>}
        {!closed && (
          <>
            <Field label={nextAction ? "Add another next action" : "Next action (required)"}>
              <select className="input" name="action_type" defaultValue="call">
                {["call", "whatsapp", "meeting", "payment", "email", "other"].map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
              </select>
            </Field>
            <Field label="What to do"><input className="input" name="action_note" placeholder="e.g. Share price list" /></Field>
            <Field label="Due (IST)"><input className="input" type="datetime-local" name="action_due" required={!nextAction} /></Field>
          </>
        )}
        <div className="flex items-end"><Submit className="btn-primary" pendingText="Saving…">Save</Submit></div>
      </ActionForm>
    </section>
  );
}

export function PaymentPanel({ leadId, status, amount, due }: { leadId: string; status: string; amount: number | null; due: string | null }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-navy-900">Payment</h2>
      <ActionForm action={setPayment} className="space-y-2">
        <input type="hidden" name="id" value={leadId} />
        <Field label="Status">
          <select className="input" name="payment_status" defaultValue={status}>
            <option value="none">No payment expected</option><option value="pending">Pending</option><option value="partial">Partially paid</option><option value="paid">Paid</option>
          </select>
        </Field>
        <Field label="Amount due (₹)"><input className="input" type="number" min={0} step="0.01" name="amount" defaultValue={amount ?? ""} /></Field>
        <Field label="Due date (IST)"><input className="input" type="datetime-local" name="due" defaultValue={toLocalInput(due)} /></Field>
        <Submit className="btn-ghost">Save payment</Submit>
      </ActionForm>
    </section>
  );
}

type Enr = { id: string; status: string; status_reason: string | null; current_step: number; next_run_at: string; journey: string };
export function JourneyPanel({ leadId, enrollment, journeys }: { leadId: string; enrollment: Enr | null; journeys: { id: string; name: string }[] }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-navy-900">Nurturing journey</h2>
      {enrollment ? (
        <div className="space-y-2 text-sm">
          <div><b>{enrollment.journey}</b> <span className="badge ml-1 bg-slate-100 capitalize">{enrollment.status}</span></div>
          <div className="text-xs text-slate-500">Step {enrollment.current_step}{enrollment.status === "active" ? ` · next run ${fmtDateTime(enrollment.next_run_at)}` : ""}{enrollment.status_reason ? ` · ${enrollment.status_reason}` : ""}</div>
          <div className="flex gap-1">
            {enrollment.status === "active" && <ActionButton action={() => enrollmentAction(enrollment.id, "pause")}>Pause</ActionButton>}
            {enrollment.status !== "active" && <ActionButton action={() => enrollmentAction(enrollment.id, "resume")} confirm="Resume this journey?">Resume</ActionButton>}
            <ActionButton action={() => enrollmentAction(enrollment.id, "stop")} confirm="Stop this journey for the customer?">Stop</ActionButton>
          </div>
        </div>
      ) : journeys.length === 0 ? <p className="text-xs text-slate-500">No active journeys.</p> : (
        <ActionForm action={enrollLead} className="space-y-2">
          <input type="hidden" name="lead_id" value={leadId} />
          <select className="input" name="journey_id" required defaultValue="" aria-label="Journey"><option value="" disabled>Choose journey…</option>{journeys.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="force" /> Override another running journey / re-run</label>
          <Submit className="btn-ghost">Enrol</Submit>
        </ActionForm>
      )}
    </section>
  );
}

export function AssignPanel({ leadId, ownerId, users }: { leadId: string; ownerId: string | null; users: { id: string; name: string }[] }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-navy-900">Owner</h2>
      <ActionForm action={assignLeads}>
        <input type="hidden" name="lead_ids" value={leadId} />
        <Field label="Assign to">
          <select className="input" name="owner_id" defaultValue={ownerId ?? ""}>
            <option value="">— Unassigned —</option>
            {!ownerId && <option value="__auto__">Round-robin (allocation rules)</option>}
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label={ownerId ? "Reassignment reason (required)" : "Reason (optional)"}><input className="input" name="reason" required={!!ownerId} /></Field>
        <Submit className="btn-navy">Save owner</Submit>
        <p className="text-xs text-slate-500">Linked WhatsApp chats move with the lead owner.</p>
      </ActionForm>
    </section>
  );
}

type F = { id: string; due_at: string; note: string | null; status: string; who?: string; completed_at: string | null };
export function FollowupPanel({ leadId, items }: { leadId: string; items: F[] }) {
  const pending = items.filter((f) => f.status === "pending");
  const [now] = useState(() => Date.now());
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-navy-900">Follow-ups</h2>
      <ActionForm action={addFollowup} resetOnOk className="mb-3 space-y-2">
        <input type="hidden" name="id" value={leadId} />
        <Field label="Due (IST)"><input className="input" type="datetime-local" name="due_at" required /></Field>
        <Field label="Note"><input className="input" name="note" /></Field>
        <Submit className="btn-ghost">Schedule follow-up</Submit>
      </ActionForm>
      {items.length === 0 ? <p className="text-sm text-slate-500">No follow-ups.</p> : (
        <ul className="divide-y text-sm">
          {[...pending, ...items.filter((f) => f.status !== "pending")].map((f) => (
            <li key={f.id} className="flex items-start justify-between gap-2 py-2">
              <div>
                <div className={f.status === "pending" && new Date(f.due_at).getTime() < now ? "font-medium text-red-600" : ""}>{fmtDateTime(f.due_at)}</div>
                <div className="text-xs text-slate-500">{f.note ?? ""} {f.who ? `· ${f.who}` : ""} {f.status !== "pending" ? `· ${f.status}` : ""}</div>
              </div>
              {f.status === "pending" && (
                <span className="flex gap-1">
                  <ActionButton action={() => completeFollowup(f.id)}>Done</ActionButton>
                  <ActionButton action={() => completeFollowup(f.id, true)} confirm="Cancel this follow-up?">✕</ActionButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ActivityPanel({ leadId }: { leadId: string }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-navy-900">Log activity</h2>
      <ActionForm action={logActivity} resetOnOk className="space-y-2">
        <input type="hidden" name="id" value={leadId} />
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1"><input type="radio" name="type" value="note" defaultChecked /> Note</label>
          <label className="flex items-center gap-1"><input type="radio" name="type" value="call" /> Call</label>
        </div>
        <textarea className="input" name="body" rows={2} required placeholder="What happened?" />
        <Submit className="btn-ghost">Save</Submit>
      </ActionForm>
    </section>
  );
}

export function ChatPanel({ leadId, convs, numbers }: { leadId: string; convs: { id: string; status: string; unread: number; last: string | null; number: string }[]; numbers: { id: string; label: string }[] }) {
  const [num, setNum] = useState(numbers[0]?.id ?? "");
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-navy-900">WhatsApp</h2>
      {convs.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm">
          {convs.map((c) => (
            <li key={c.id}><Link href={`/inbox?c=${c.id}`} className="text-brand-700 hover:underline">{c.number} chat</Link>
              <span className="ml-2 text-xs capitalize text-slate-500">{c.status}{c.unread ? ` · ${c.unread} unread` : ""} · {fmtDateTime(c.last)}</span></li>
          ))}
        </ul>
      )}
      {numbers.length === 0 ? <p className="text-xs text-slate-500">No WhatsApp number available to you.</p> : (
        <div className="flex gap-2">
          <select className="input" value={num} onChange={(e) => setNum(e.target.value)} aria-label="Business number">
            {numbers.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
          <button className="btn-ghost whitespace-nowrap" disabled={pending || !num} onClick={() => start(async () => {
            const r = await startConversation(leadId, num);
            if (r.error) setErr(r.error); else router.push(`/inbox?c=${r.id}`);
          })}>Open chat</button>
        </div>
      )}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </section>
  );
}

type L = { id: string; name: string | null; email: string | null; location: string | null; branch_id: string | null; department_id: string | null; product_id: string | null; source_id: string | null; priority: string; expected_value: number | null; won_value: number | null; notes: string | null; status_category: string };
export function EditPanel({ lead, refs, tagIds }: { lead: L; refs: Refs; tagIds: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card p-4">
      <button className="flex w-full items-center justify-between text-sm font-semibold text-navy-900" onClick={() => setOpen((o) => !o)}>
        Lead details <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ActionForm action={updateLead} className="mt-3 space-y-2">
          <input type="hidden" name="id" value={lead.id} />
          <Field label="Customer name"><input className="input" name="name" defaultValue={lead.name ?? ""} /></Field>
          <Field label="Email"><input className="input" type="email" name="email" defaultValue={lead.email ?? ""} /></Field>
          <Field label="Location"><input className="input" name="location" defaultValue={lead.location ?? ""} /></Field>
          <Field label="Product / Service"><select className="input" name="product_id" defaultValue={lead.product_id ?? ""}><option value="">—</option>{refs.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Source"><select className="input" name="source_id" defaultValue={lead.source_id ?? ""}><option value="">—</option>{refs.sources.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Branch"><select className="input" name="branch_id" defaultValue={lead.branch_id ?? ""}><option value="">—</option>{refs.branches.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Department"><select className="input" name="department_id" defaultValue={lead.department_id ?? ""}><option value="">—</option>{refs.departments.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Priority"><select className="input" name="priority" defaultValue={lead.priority}>{["low", "normal", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Expected value (₹)"><input className="input" type="number" min={0} step="0.01" name="expected_value" defaultValue={lead.expected_value ?? ""} /></Field>
          {lead.status_category === "won" && <Field label="Actual won value (₹)"><input className="input" type="number" min={0} step="0.01" name="won_value" defaultValue={lead.won_value ?? ""} /></Field>}
          {refs.tags.length > 0 && <fieldset><legend className="label">Tags</legend><div className="flex flex-wrap gap-2">{refs.tags.map((t) => <label key={t.id} className="flex items-center gap-1 text-sm"><input type="checkbox" name="tag_ids" value={t.id} defaultChecked={tagIds.includes(t.id)} /> {t.name}</label>)}</div></fieldset>}
          <Field label="Notes"><textarea className="input" name="notes" rows={3} defaultValue={lead.notes ?? ""} /></Field>
          <Submit>Save details</Submit>
        </ActionForm>
      )}
    </section>
  );
}

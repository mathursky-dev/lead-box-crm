"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/kit";
import { EXPENSE_CATEGORIES, QUEUE_LABEL, VISIT_OUTCOMES, categoryLabel, expenseStatusOf, fmtHours, rupees, type GeoPoint, type QueueItem } from "@/lib/field";
import { QUEUE_EVENT, enqueue, flushQueue, getGeo, kvGet, kvSet, listQueue, newId, removeEntry, retryEntry, shrinkImage, type QueueEntry } from "@/lib/offline/queue";

// Mobile-first field app. Everything is saved on the phone first (IndexedDB) and sent to
// the server by the offline queue, so it works the same with or without network.

export type FieldServerState = {
  renderedAt: number;
  session: { client_id: string; at: string } | null;
  firstIn: string | null;
  workedMin: number;
  visit: { client_id: string; at: string; name: string; lead_id: string | null } | null;
  visitsToday: number;
  expenses: { id: string; no: number; date: string; category: string; amount: number; status: string; note: string }[];
  pendingApprovals: number;
};
type Local = { session: FieldServerState["session"]; visit: FieldServerState["visit"]; firstIn: string | null; updatedAt: number };
type Lead = { id: string; no: number; name: string; phone: string; loc: string };

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const todayYmd = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const since = (iso: string) => fmtHours((Date.now() - new Date(iso).getTime()) / 60000);
const geoText = (g: GeoPoint) => (g ? `Location saved (±${g.acc} m)` : "Location not available: saved without GPS");

export function FieldApp({ userId, name, server, openExpense = false }: { userId: string; name: string; server: FieldServerState; openExpense?: boolean }) {
  const router = useRouter();
  const stateKey = `field:${userId}`;
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [local, setLocal] = useState<Local>({ session: server.session, visit: server.visit, firstIn: server.firstIn, updatedAt: server.renderedAt });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [, tick] = useState(0);

  const say = (text: string, tone: "ok" | "err" = "ok") => { setToast({ text, tone }); window.setTimeout(() => setToast(null), 4500); };
  const refreshQueue = useCallback(async () => { try { setQueue(await listQueue(userId)); } catch { /* no IndexedDB */ } }, [userId]);

  const save = useCallback(async (next: Omit<Local, "updatedAt">) => {
    const v = { ...next, updatedAt: Date.now() };
    setLocal(v);
    await kvSet(stateKey, v);
  }, [stateKey]);

  // Pick server state when this page is fresh and nothing about attendance/visits is still waiting; otherwise the phone's copy.
  useEffect(() => {
    (async () => {
      const [saved, q] = await Promise.all([kvGet<Local>(stateKey), listQueue(userId).catch(() => [] as QueueEntry[])]);
      setQueue(q);
      const waiting = q.some((e) => ["checkin", "checkout", "visit_start", "visit_end"].includes(e.item.kind));
      const fresh = Date.now() - server.renderedAt < 120000;
      if (saved && (waiting || !fresh || saved.updatedAt > server.renderedAt)) setLocal(saved);
      else await kvSet(stateKey, { session: server.session, visit: server.visit, firstIn: server.firstIn, updatedAt: server.renderedAt });
      const cached = await kvGet<{ leads: Lead[] }>(`leads:${userId}`);
      if (cached?.leads) setLeads(cached.leads);
    })();
  }, [stateKey, userId, server]);

  // Network status, queue changes, and the leads copy for offline search.
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    on();
    window.addEventListener("online", on); window.addEventListener("offline", on);
    window.addEventListener(QUEUE_EVENT, refreshQueue);
    const t = window.setInterval(() => tick((n) => n + 1), 30000);
    if (navigator.onLine) {
      fetch("/api/field/leads", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(async (d) => {
        if (d?.leads) { setLeads(d.leads); await kvSet(`leads:${userId}`, d); }
      }).catch(() => {});
    }
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); window.removeEventListener(QUEUE_EVENT, refreshQueue); window.clearInterval(t); };
  }, [refreshQueue, userId]);

  const sync = useCallback(async (manual = false) => {
    const r = await flushQueue(userId);
    await refreshQueue();
    if (r.signedOut) say("Session expired: sign in again to send the saved entries.", "err");
    else if (manual && r.offline) say("No network: entries stay saved on this phone.", "err");
    else if (r.failed && manual) say(`${r.failed} entr${r.failed === 1 ? "y" : "ies"} need attention below.`, "err");
    else if (manual && r.sent) say(`Sent ${r.sent} entr${r.sent === 1 ? "y" : "ies"}.`);
    if (r.sent && navigator.onLine) router.refresh();
    return r;
  }, [userId, refreshQueue, router]);

  /** Save on the phone, then try to send right away. */
  const submit = async (item: QueueItem, okText: string, file?: Blob | null) => {
    try {
      await enqueue(userId, item, file);
    } catch {
      say("Could not save on this phone (storage blocked). Try again with network.", "err");
      return false;
    }
    const r = await sync();
    say(r.offline || !navigator.onLine ? `${okText} · saved offline, will sync when online` : okText);
    return true;
  };

  // ── Attendance ──
  const checkIn = async () => {
    setBusy("att");
    const geo = await getGeo();
    const item: QueueItem = { kind: "checkin", client_id: newId(), at: new Date().toISOString(), geo };
    if (await submit(item, `Checked in · ${geoText(geo)}`)) await save({ ...local, session: { client_id: item.client_id, at: item.at }, firstIn: local.firstIn ?? item.at });
    setBusy(null);
  };
  const checkOut = async () => {
    if (!local.session) return;
    if (local.visit && !window.confirm("A visit is still open. Check out anyway?")) return;
    setBusy("att");
    const geo = await getGeo();
    if (await submit({ kind: "checkout", client_id: local.session.client_id, at: new Date().toISOString(), geo }, `Checked out · ${geoText(geo)}`)) {
      await save({ ...local, session: null });
    }
    setBusy(null);
  };

  const pendingCount = queue.filter((e) => !e.error).length;
  const failed = queue.filter((e) => e.error);

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-navy-900">Hi {name.split(" ")[0]}</h1>
          <p className="text-xs text-slate-500">Check in, log visits and expenses. Works without network too.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${online ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
            <Icon name={online ? "globe" : "wifiOff"} className="h-3 w-3" />{online ? "Online" : "Offline"}
          </span>
          {pendingCount > 0 && <button className="btn-ghost btn-sm" onClick={() => sync(true)}><Icon name="refresh" className="h-3 w-3" />Sync {pendingCount}</button>}
        </div>
      </div>

      {toast && <div role="status" className={`rounded-lg px-3 py-2 text-sm ${toast.tone === "ok" ? "bg-brand-50 text-brand-700" : "bg-red-50 text-red-700"}`}>{toast.text}</div>}

      {/* Attendance */}
      <section className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-navy-900"><Icon name="clock" className="h-4 w-4 text-brand-600" />Attendance</div>
            {local.session ? (
              <p className="mt-1 text-sm text-slate-600">Checked in at <b>{clock(local.session.at)}</b> · {since(local.session.at)} ago</p>
            ) : (
              <p className="mt-1 text-sm text-slate-600">{local.firstIn ? `Today's first check-in ${clock(local.firstIn)}. You are checked out.` : "Not checked in yet today."}</p>
            )}
          </div>
          {local.session
            ? <button className="btn-danger px-5 py-3 text-base" disabled={busy === "att"} onClick={checkOut}>{busy === "att" ? "Getting location…" : "Check out"}</button>
            : <button className="btn-primary px-5 py-3 text-base" disabled={busy === "att"} onClick={checkIn}>{busy === "att" ? "Getting location…" : "Check in"}</button>}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Your GPS location is saved with each check-in and check-out. Allow location when the phone asks.</p>
      </section>

      <VisitCard local={local} leads={leads} busy={busy} setBusy={setBusy} submit={submit} save={save} visitsToday={server.visitsToday} />
      <ExpenseCard leads={leads} visitClientId={local.visit?.client_id ?? null} submit={submit} initialOpen={openExpense} />
      <QuickLeadCard submit={submit} />
      <NoteCard leads={leads} submit={submit} />

      {(pendingCount > 0 || failed.length > 0) && (
        <section className="card p-4">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold text-navy-900">
            <span className="flex items-center gap-2"><Icon name="upload" className="h-4 w-4 text-amber-600" />Saved on this phone</span>
            {online && pendingCount > 0 && <button className="btn-ghost btn-sm" onClick={() => sync(true)}>Send now</button>}
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {queue.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="font-medium text-navy-900">{QUEUE_LABEL[e.item.kind]} <span className="font-normal text-slate-400">· {new Date(e.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
                  {e.error ? <div className="text-xs text-red-600">{e.error}</div> : <div className="text-xs text-slate-500">Waiting for network</div>}
                </div>
                {e.error && (
                  <div className="flex shrink-0 gap-1">
                    <button className="btn-ghost btn-sm" onClick={async () => { await retryEntry(e.id); await sync(true); }}>Retry</button>
                    <button className="btn-ghost btn-sm text-red-600" onClick={async () => { if (window.confirm("Delete this saved entry? It will not reach the CRM.")) await removeEntry(e.id); }}>Discard</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between text-sm font-semibold text-navy-900">
          <span className="flex items-center gap-2"><Icon name="rupee" className="h-4 w-4 text-brand-600" />My recent expenses</span>
          <Link href="/field/expenses" className="text-xs font-medium text-brand-700">All →</Link>
        </div>
        {server.pendingApprovals > 0 && (
          <Link href="/field/expenses?status=pending" className="mb-2 block rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
            {server.pendingApprovals} team expense{server.pendingApprovals === 1 ? "" : "s"} waiting for your approval →
          </Link>
        )}
        {server.expenses.length === 0 ? <p className="text-sm text-slate-500">No expenses yet.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {server.expenses.map((x) => {
              const st = expenseStatusOf(x.status);
              return (
                <li key={x.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0"><div className="truncate text-navy-900">{categoryLabel(x.category)} · {x.date.split("-").reverse().join("-")}</div>
                    {x.note && <div className="truncate text-xs text-slate-500">{x.note}</div>}</div>
                  <div className="flex shrink-0 items-center gap-2"><b>{rupees(x.amount)}</b><span className={`badge ${st.cls}`}>{st.label}</span></div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

type Submit = (item: QueueItem, okText: string, file?: Blob | null) => Promise<boolean>;

function VisitCard({ local, leads, busy, setBusy, submit, save, visitsToday }: {
  local: Local; leads: Lead[]; busy: string | null; setBusy: (v: string | null) => void; submit: Submit;
  save: (n: Omit<Local, "updatedAt">) => Promise<void>; visitsToday: number;
}) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [customer, setCustomer] = useState("");
  const [purpose, setPurpose] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [follow, setFollow] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const start = async () => {
    if (!lead && !customer.trim()) return alert("Pick a lead or write the customer name.");
    setBusy("visit");
    const geo = await getGeo();
    const item: QueueItem = { kind: "visit_start", client_id: newId(), at: new Date().toISOString(), geo, lead_id: lead?.id ?? null, customer_name: lead ? "" : customer.trim(), purpose: purpose.trim() };
    if (await submit(item, `Visit started · ${geoText(geo)}`)) {
      await save({ ...local, visit: { client_id: item.client_id, at: item.at, lead_id: lead?.id ?? null, name: lead ? `${lead.name || lead.phone} · LB-${lead.no}` : customer.trim() } });
      setLead(null); setCustomer(""); setPurpose("");
    }
    setBusy(null);
  };
  const end = async () => {
    if (!local.visit) return;
    if (!outcome) return alert("Choose how the visit went.");
    setBusy("visit");
    const geo = await getGeo();
    const followAt = follow ? new Date(follow).toISOString() : null;
    if (await submit({ kind: "visit_end", client_id: local.visit.client_id, at: new Date().toISOString(), geo, outcome, notes: notes.trim(), followup_at: followAt, lead_id: local.visit.lead_id }, "Visit report saved", photo)) {
      await save({ ...local, visit: null });
      setOutcome(""); setNotes(""); setFollow(""); setPhoto(null); if (fileRef.current) fileRef.current.value = "";
    }
    setBusy(null);
  };

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between text-sm font-semibold text-navy-900">
        <span className="flex items-center gap-2"><Icon name="pin" className="h-4 w-4 text-brand-600" />Field visit</span>
        <span className="text-xs font-normal text-slate-500">{visitsToday} today</span>
      </div>
      {local.visit ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">At <b>{local.visit.name}</b> since {clock(local.visit.at)} ({since(local.visit.at)})</div>
          <label className="block"><span className="label">How did it go? *</span>
            <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">Choose…</option>{VISIT_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select></label>
          <label className="block"><span className="label">Visit report</span>
            <textarea className="input" rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was discussed, requirement, next step…" /></label>
          {local.visit.lead_id && <label className="block"><span className="label">Next follow-up (optional)</span>
            <input type="datetime-local" className="input" value={follow} onChange={(e) => setFollow(e.target.value)} /></label>}
          <label className="block"><span className="label">Photo (optional)</span>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="block w-full text-sm"
              onChange={async (e) => { const f = e.target.files?.[0]; setPhoto(f ? await shrinkImage(f) : null); }} /></label>
          <button className="btn-primary w-full py-3" disabled={busy === "visit"} onClick={end}>{busy === "visit" ? "Getting location…" : "End visit & save report"}</button>
        </div>
      ) : (
        <div className="space-y-3">
          <LeadPicker leads={leads} value={lead} onChange={setLead} />
          {!lead && <label className="block"><span className="label">…or customer / shop name</span>
            <input className="input" maxLength={200} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="New customer name" /></label>}
          <label className="block"><span className="label">Purpose</span>
            <input className="input" maxLength={200} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Demo, site visit, payment collection…" /></label>
          <button className="btn-navy w-full py-3" disabled={busy === "visit"} onClick={start}>{busy === "visit" ? "Getting location…" : "Start visit (save location)"}</button>
        </div>
      )}
    </section>
  );
}

function ExpenseCard({ leads, visitClientId, submit, initialOpen }: { leads: Lead[]; visitClientId: string | null; submit: Submit; initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [date, setDate] = useState(todayYmd());
  const [category, setCategory] = useState("travel");
  const [amount, setAmount] = useState("");
  const [km, setKm] = useState("");
  const [desc, setDesc] = useState("");
  const [lead, setLead] = useState<Lead | null>(null);
  const [file, setFile] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const go = async () => {
    const amt = Number(amount);
    if (!(amt > 0)) return alert("Enter the amount.");
    setSaving(true);
    const ok = await submit({ kind: "expense", client_id: newId(), date, category, amount: amt, km: km ? Number(km) : null, description: desc.trim(), lead_id: lead?.id ?? null, visit_client_id: visitClientId },
      `Expense ${rupees(amt)} sent for approval`, file);
    if (ok) { setAmount(""); setKm(""); setDesc(""); setLead(null); setFile(null); if (fileRef.current) fileRef.current.value = ""; setOpen(false); }
    setSaving(false);
  };

  return (
    <section className="card p-4">
      <button className="flex w-full items-center justify-between text-sm font-semibold text-navy-900" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="flex items-center gap-2"><Icon name="rupee" className="h-4 w-4 text-brand-600" />Add expense claim</span>
        <Icon name={open ? "chevronDown" : "chevronRight"} className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="label">Date</span><input type="date" className="input" value={date} max={todayYmd()} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="block"><span className="label">Amount (₹) *</span><input type="number" inputMode="decimal" min="1" step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          </div>
          <label className="block"><span className="label">Type</span>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
          {(category === "fuel" || category === "travel") && <label className="block"><span className="label">Distance (km)</span>
            <input type="number" inputMode="decimal" min="0" step="0.1" className="input" value={km} onChange={(e) => setKm(e.target.value)} /></label>}
          <label className="block"><span className="label">Details</span><input className="input" maxLength={1000} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Office to client site and back" /></label>
          <LeadPicker leads={leads} value={lead} onChange={setLead} label="For lead (optional)" />
          <label className="block"><span className="label">Bill / receipt photo</span>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" className="block w-full text-sm"
              onChange={async (e) => { const f = e.target.files?.[0]; setFile(f ? await shrinkImage(f) : null); }} /></label>
          {visitClientId && <p className="text-xs text-slate-500">Will be linked to your open visit.</p>}
          <button className="btn-primary w-full py-3" disabled={saving} onClick={go}>{saving ? "Saving…" : "Submit for approval"}</button>
        </div>
      )}
    </section>
  );
}

function QuickLeadCard({ submit }: { submit: Submit }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const go = async () => {
    if (phone.replace(/\D/g, "").length < 8) return alert("Enter the mobile number.");
    if (await submit({ kind: "lead", client_id: newId(), name: name.trim(), phone: phone.trim(), notes: notes.trim() }, "Lead saved")) { setName(""); setPhone(""); setNotes(""); setOpen(false); }
  };
  return (
    <section className="card p-4">
      <button className="flex w-full items-center justify-between text-sm font-semibold text-navy-900" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="flex items-center gap-2"><Icon name="userPlus" className="h-4 w-4 text-brand-600" />Quick new lead</span>
        <Icon name={open ? "chevronDown" : "chevronRight"} className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <label className="block"><span className="label">Mobile / WhatsApp *</span><input type="tel" inputMode="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98xxxxxxxx" /></label>
          <label className="block"><span className="label">Name</span><input className="input" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block"><span className="label">Notes</span><textarea className="input" rows={2} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          <button className="btn-primary w-full py-3" onClick={go}>Save lead</button>
        </div>
      )}
    </section>
  );
}

function NoteCard({ leads, submit }: { leads: Lead[]; submit: Submit }) {
  const [open, setOpen] = useState(false);
  const [lead, setLead] = useState<Lead | null>(null);
  const [body, setBody] = useState("");
  const go = async () => {
    if (!lead) return alert("Pick the lead.");
    if (!body.trim()) return alert("Write the note.");
    if (await submit({ kind: "note", client_id: newId(), lead_id: lead.id, body: body.trim() }, `Note saved on LB-${lead.no}`)) { setBody(""); setLead(null); setOpen(false); }
  };
  return (
    <section className="card p-4">
      <button className="flex w-full items-center justify-between text-sm font-semibold text-navy-900" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="flex items-center gap-2"><Icon name="pencil" className="h-4 w-4 text-brand-600" />Add note on a lead</span>
        <Icon name={open ? "chevronDown" : "chevronRight"} className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <LeadPicker leads={leads} value={lead} onChange={setLead} />
          <label className="block"><span className="label">Note</span><textarea className="input" rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <button className="btn-primary w-full py-3" onClick={go}>Save note</button>
        </div>
      )}
    </section>
  );
}

/** Search the leads kept on the phone (works offline). */
function LeadPicker({ leads, value, onChange, label = "Lead" }: { leads: Lead[]; value: Lead | null; onChange: (l: Lead | null) => void; label?: string }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^lb-?/, "");
    if (t.length < 2) return [];
    const digits = t.replace(/\D/g, "");
    return leads.filter((l) => l.name.toLowerCase().includes(t) || (digits.length >= 3 && l.phone.includes(digits)) || String(l.no) === t || l.loc.toLowerCase().includes(t)).slice(0, 8);
  }, [q, leads]);
  if (value) {
    return (
      <div><span className="label">{label}</span>
        <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
          <span className="truncate"><b>{value.name || value.phone}</b> · LB-{value.no}</span>
          <button className="text-xs text-slate-500" onClick={() => onChange(null)}>Change</button>
        </div>
      </div>
    );
  }
  return (
    <div className="relative">
      <label className="block"><span className="label">{label}</span>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={leads.length ? "Search name, phone or LB number" : "Leads load when online"} /></label>
      {hits.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {hits.map((l) => (
            <li key={l.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { onChange(l); setQ(""); }}>
              <b>{l.name || l.phone}</b> <span className="text-slate-400">· LB-{l.no}{l.loc ? ` · ${l.loc}` : ""}</span><div className="text-xs text-slate-500">{l.phone}</div>
            </button></li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && hits.length === 0 && <p className="mt-1 text-xs text-slate-500">No lead found on this phone.</p>}
    </div>
  );
}

"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { fmtClock, fmtDay, fmtDateTime } from "@/lib/dates";
import { sendSocialMessage, socialThreadAction, socialCreateLead, socialLinkLead, socialUnlinkLead, refreshSocialProfile } from "@/lib/actions/social";

// Instagram DM / Messenger chats, shown as a tab of the Inbox. Same layout as the WhatsApp inbox:
// chat list on the left, the conversation on the right. Realtime events trigger a refetch.

type Channel = "instagram" | "messenger";
type Thread = {
  id: string; channel: Channel; name: string | null; username: string | null; profile_pic: string | null; psid: string; lead_id: string | null;
  assignee_id: string | null; status: "open" | "pending" | "resolved"; unread_count: number; last_message_at: string | null; last_message_preview: string | null; last_inbound_at: string | null;
  lead?: { lead_no: number } | null;
};
type Msg = { id: string; direction: "in" | "out" | "note"; body: string | null; attachments: { type: string; url: string | null; title?: string | null }[]; status: string; error_message: string | null; sent_by: string | null; created_at: string };
type Props = {
  channel: Channel; initialId: string | null;
  me: { id: string; manager: boolean; canSend: boolean; canTransfer: boolean; canLead: boolean };
  users: { id: string; name: string }[];
};

const PAGE = 30;
const LABEL: Record<Channel, string> = { instagram: "Instagram", messenger: "Messenger" };
const who = (t: Pick<Thread, "name" | "username" | "psid">) => t.name || (t.username ? `@${t.username}` : `User ${t.psid.slice(-6)}`);
const ageMs = (ts: string | null) => (ts ? Date.now() - new Date(ts).getTime() : Infinity);
const PHONE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b|\+\d[\d\s-]{8,15}\d/;

function Avatar({ t }: { t: Pick<Thread, "profile_pic" | "name" | "username" | "psid" | "channel"> }) {
  const [bad, setBad] = useState(false);
  if (t.profile_pic && !bad) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={t.profile_pic} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" onError={() => setBad(true)} referrerPolicy="no-referrer" />;
  }
  return (
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-white ${t.channel === "instagram" ? "bg-gradient-to-tr from-amber-400 via-pink-500 to-violet-600" : "bg-[#0084FF]"}`}>
      {who(t).replace(/^@/, "").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function SocialInbox({ channel, initialId, me, users }: Props) {
  const sb = getBrowserClient();
  const [view, setView] = useState<"mine" | "unassigned" | "all">(me.manager ? "all" : "mine");
  const [status, setStatus] = useState<"" | "open" | "pending" | "resolved">("open");
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [list, setList] = useState<Thread[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selId, setSelId] = useState<string | null>(initialId);
  const [sel, setSel] = useState<Thread | null>(null);
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState(false);
  const names = new Map(users.map((u) => [u.id, u.name]));

  useEffect(() => { const x = setTimeout(() => setQd(q), 300); return () => clearTimeout(x); }, [q]);

  const loadList = useCallback(async () => {
    let qy = sb.from("lb_social_threads").select("*, lead:lb_leads(lead_no)", { count: "exact" }).eq("channel", channel)
      .order("last_message_at", { ascending: false, nullsFirst: false }).limit(limit);
    if (status) qy = qy.eq("status", status);
    if (view === "mine") qy = qy.eq("assignee_id", me.id);
    if (view === "unassigned") qy = qy.is("assignee_id", null);
    const term = qd.trim().replace(/[%,()]/g, " ");
    if (term) qy = qy.or(`name.ilike.%${term}%,username.ilike.%${term}%,last_message_preview.ilike.%${term}%`);
    const { data, error, count } = await qy;
    if (error) { setState("error"); return; }
    setList(data as Thread[]); setTotal(count ?? 0); setState("ready");
  }, [sb, channel, status, view, qd, limit, me.id]);

  const loadSel = useCallback(async () => {
    if (!selId) { setSel(null); return; }
    const { data } = await sb.from("lb_social_threads").select("*, lead:lb_leads(lead_no)").eq("id", selId).maybeSingle();
    setSel((data as Thread) ?? null);
  }, [sb, selId]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadSel(); }, [loadSel]);
  useEffect(() => {
    let x: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { clearTimeout(x); x = setTimeout(() => setTick((n) => n + 1), 250); };
    const ch = sb.channel(`social-${channel}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lb_social_threads" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "lb_social_messages" }, bump)
      .subscribe((s: string) => { setLive(s === "SUBSCRIBED"); if (s === "SUBSCRIBED") bump(); });
    window.addEventListener("focus", bump);
    return () => { clearTimeout(x); sb.removeChannel(ch); window.removeEventListener("focus", bump); };
  }, [sb, channel]);
  useEffect(() => { if (tick) { loadList(); loadSel(); } }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (id: string) => { setSelId(id); window.history.replaceState(null, "", `/inbox?ch=${channel}&t=${id}`); };

  return (
    <div className="flex h-full bg-white">
      <section className={`flex w-full flex-col border-r border-slate-200 md:w-80 md:shrink-0 ${selId ? "max-md:hidden" : ""}`}>
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center justify-between">
            <h1 className="font-semibold text-navy-900">{LABEL[channel]}</h1>
            <span className={`text-[11px] ${live ? "text-brand-600" : "text-amber-600"}`}>{live ? "● live" : "● reconnecting"}</span>
          </div>
          <input className="input" placeholder="Search name, @username, message" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex gap-1 text-xs">
            {(["mine", ...(me.manager ? ["unassigned", "all"] : [])] as const).map((v) => (
              <button key={v} onClick={() => setView(v as typeof view)} className={`rounded px-2 py-1 capitalize ${view === v ? "bg-navy-900 text-white" : "bg-slate-100"}`}>{v}</button>
            ))}
          </div>
          <div className="flex gap-1 text-xs">
            {(["open", "pending", "resolved", ""] as const).map((s) => (
              <button key={s || "any"} onClick={() => setStatus(s)} className={`rounded px-2 py-1 capitalize ${status === s ? "bg-brand-600 text-white" : "bg-slate-100"}`}>{s || "all"}</button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {state === "loading" && <div className="p-4 text-sm text-slate-500">Loading…</div>}
          {state === "error" && <div className="p-4 text-sm text-red-600">Couldn&apos;t load chats. <button className="underline" onClick={loadList}>Retry</button></div>}
          {state === "ready" && list.length === 0 && <div className="p-6 text-center text-sm text-slate-500">No {LABEL[channel]} chats here yet.</div>}
          {list.map((t) => (
            <button key={t.id} onClick={() => open(t.id)} className={`flex w-full gap-2 border-b px-3 py-2.5 text-left hover:bg-slate-50 ${selId === t.id ? "bg-brand-50" : ""}`}>
              <Avatar t={t} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${t.unread_count ? "font-semibold text-navy-900" : "text-slate-800"}`}>{who(t)}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{t.last_message_at && (new Date(t.last_message_at).toDateString() === new Date().toDateString() ? fmtClock(t.last_message_at) : fmtDay(t.last_message_at))}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-slate-500">{t.last_message_preview}</span>
                  {t.unread_count > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">{t.unread_count}</span>}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-400">{t.assignee_id ? names.get(t.assignee_id) ?? "Assigned" : "Unassigned"}{t.lead?.lead_no ? ` · LB-${t.lead.lead_no}` : ""}</span>
              </span>
            </button>
          ))}
          {total > list.length && <button className="w-full p-3 text-sm text-brand-700" onClick={() => setLimit((l) => l + PAGE)}>Load more ({total - list.length})</button>}
        </div>
      </section>
      {selId && sel ? (
        <Chat key={sel.id} t={sel} me={me} users={users} tick={tick}
          onBack={() => { setSelId(null); window.history.replaceState(null, "", `/inbox?ch=${channel}`); }}
          onChanged={() => { loadList(); loadSel(); }} />
      ) : (
        <div className="hidden flex-1 items-center justify-center text-sm text-slate-400 md:flex">{selId ? "Loading…" : "Select a chat"}</div>
      )}
    </div>
  );
}

function Attachment({ a }: { a: Msg["attachments"][number] }) {
  if (!a.url) return <div className="text-xs italic opacity-80">[{a.type}]</div>;
  if (a.type === "image" || a.type === "story_reply" || a.type === "story_mention") {
    return (
      <a href={a.url} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.url} alt={a.type === "image" ? "Image" : "Story"} className="max-h-60 rounded" referrerPolicy="no-referrer" />
        {a.type !== "image" && <span className="text-[11px] opacity-80">{a.type === "story_reply" ? "Replied to your story" : "Mentioned you in a story"}</span>}
      </a>
    );
  }
  if (a.type === "video") return <video src={a.url} controls className="max-h-60 rounded" />;
  if (a.type === "audio") return <audio src={a.url} controls className="max-w-full" />;
  return <a href={a.url} target="_blank" rel="noopener noreferrer" className="underline">📎 {a.title || a.type}</a>;
}

function Chat({ t, me, users, tick, onBack, onChanged }: { t: Thread; me: Props["me"]; users: Props["users"]; tick: number; onBack: () => void; onChanged: () => void }) {
  const sb = getBrowserClient();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [text, setText] = useState("");
  const [note, setNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [leadBox, setLeadBox] = useState(false);
  const clientId = useRef<string>(crypto.randomUUID());
  const endRef = useRef<HTMLDivElement>(null);
  const names = new Map(users.map((u) => [u.id, u.name]));

  const load = useCallback(async () => {
    const { data, error } = await sb.from("lb_social_messages").select("id,direction,body,attachments,status,error_message,sent_by,created_at")
      .eq("thread_id", t.id).order("created_at", { ascending: false }).limit(100);
    if (error) { setState("error"); return; }
    setMsgs((data as Msg[]).reverse()); setState("ready");
  }, [sb, t.id]);
  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => { if (t.unread_count > 0) socialThreadAction(t.id, "read").then(onChanged); }, [t.id, t.unread_count]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!t.name && !t.username) refreshSocialProfile(t.id).then(onChanged); }, [t.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastId = msgs[msgs.length - 1]?.id;
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [lastId]);

  const age = ageMs(t.last_inbound_at);
  const windowNote = age <= 24 * 3600000 ? null : age <= 7 * 86400000
    ? "More than 24 hours since the customer's last message: your reply goes as a human-agent message (allowed up to 7 days)."
    : "The customer hasn't written in 7 days. Meta allows a reply only after they message again.";
  const phoneHint = [...msgs].reverse().find((m) => m.direction === "in" && m.body && PHONE.test(m.body))?.body?.match(PHONE)?.[0] ?? "";

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(undefined);
    const r = note ? await socialThreadAction(t.id, "note", { body: text }) : await sendSocialMessage(t.id, clientId.current, text);
    setBusy(false);
    if (r.error) { setErr(r.error); if (!note) clientId.current = crypto.randomUUID(); load(); return; }
    setText(""); clientId.current = crypto.randomUUID(); load(); onChanged();
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <button className="md:hidden" onClick={onBack} aria-label="Back">←</button>
        <Avatar t={t} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-navy-900">{who(t)}</div>
          <div className="truncate text-xs text-slate-500">
            {LABEL[t.channel]}{t.username ? ` · @${t.username}` : ""} · {t.lead_id && t.lead ? <Link className="text-brand-700 hover:underline" href={`/leads/${t.lead_id}`}>LB-{t.lead.lead_no}</Link> : "no lead yet"}
          </div>
        </div>
        {(me.manager || me.canTransfer) && (
          <select className="input w-auto py-1 text-xs" value={t.assignee_id ?? ""} aria-label="Assign chat"
            onChange={async (e) => { const r = await socialThreadAction(t.id, "assign", { user: e.target.value || null }); if (r.error) setErr(r.error); onChanged(); }}>
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        <select className="input w-auto py-1 text-xs" value={t.status} aria-label="Chat status"
          onChange={async (e) => { const r = await socialThreadAction(t.id, "status", { status: e.target.value }); if (r.error) setErr(r.error); onChanged(); }}>
          <option value="open">Open</option><option value="pending">Pending</option><option value="resolved">Resolved</option>
        </select>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setLeadBox((v) => !v)}>{t.lead_id ? "Lead" : "+ Lead"}</button>
      </header>
      {leadBox && <LeadBox t={t} canLead={me.canLead} phoneHint={phoneHint} onDone={() => { setLeadBox(false); onChanged(); }} />}

      <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-slate-50 p-3">
        {state === "loading" && <div className="text-center text-sm text-slate-500">Loading…</div>}
        {state === "error" && <div className="text-center text-sm text-red-600">Couldn&apos;t load messages. <button className="underline" onClick={load}>Retry</button></div>}
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "in" ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${m.direction === "in" ? "bg-white text-slate-800" : m.direction === "note" ? "border border-amber-200 bg-amber-50 text-amber-900" : "bg-navy-900 text-white"}`}>
              {m.direction === "note" && <div className="mb-0.5 text-[11px] font-semibold">Internal note · {names.get(m.sent_by ?? "") ?? "Team"}</div>}
              {m.attachments?.map((a, i) => <Attachment key={i} a={a} />)}
              {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
              <div className={`mt-1 text-right text-[11px] ${m.direction === "out" ? "text-slate-300" : "text-slate-400"}`}>
                {m.direction === "out" && m.sent_by ? `${names.get(m.sent_by) ?? ""} · ` : ""}{fmtDateTime(m.created_at)}
                {m.direction === "out" && (m.status === "failed" ? <span className="ml-1 text-red-300">⚠ Failed{m.error_message ? `: ${m.error_message}` : ""}</span> : m.status === "sending" ? " · …" : " ✓")}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <footer className="space-y-2 border-t p-2">
        {windowNote && !note && <div className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{windowNote}</div>}
        {err && <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{err}</div>}
        <div className="flex gap-1 text-xs">
          <button type="button" onClick={() => setNote(false)} className={`rounded px-2 py-1 ${!note ? "bg-navy-900 text-white" : "bg-slate-100"}`}>Reply</button>
          <button type="button" onClick={() => setNote(true)} className={`rounded px-2 py-1 ${note ? "bg-amber-500 text-white" : "bg-slate-100"}`}>Internal note</button>
        </div>
        <div className="flex gap-2">
          <textarea className={`input min-h-[44px] flex-1 resize-none ${note ? "bg-amber-50" : ""}`} rows={2} value={text} maxLength={note ? 2000 : 1000}
            placeholder={note ? "Note for your team (customer can't see it)" : me.canSend ? `Reply on ${LABEL[t.channel]}` : "You can't send messages"}
            disabled={!note && !me.canSend}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <button type="button" className="btn-primary self-end" disabled={busy || !text.trim() || (!note && !me.canSend)} onClick={submit}>{busy ? "…" : note ? "Add" : "Send"}</button>
        </div>
      </footer>
    </section>
  );
}

function LeadBox({ t, canLead, phoneHint, onDone }: { t: Thread; canLead: boolean; phoneHint: string; onDone: () => void }) {
  const [phone, setPhone] = useState(phoneHint);
  const [name, setName] = useState(t.name ?? "");
  const [no, setNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>();
  const run = async (fn: () => Promise<{ ok?: string; error?: string }>) => { setBusy(true); const r = await fn(); setBusy(false); setMsg(r); if (!r.error) setTimeout(onDone, 800); };
  return (
    <div className="space-y-2 border-b bg-white p-3 text-sm">
      {t.lead_id ? (
        <div className="flex flex-wrap items-center gap-2">
          Linked to <Link className="font-medium text-brand-700 hover:underline" href={`/leads/${t.lead_id}`}>LB-{t.lead?.lead_no}</Link>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => run(() => socialUnlinkLead(t.id))}>Unlink</button>
        </div>
      ) : (
        <>
          {canLead && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block"><span className="label">Customer mobile</span><input className="input !w-44" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98xxxxxxx" /></label>
              <label className="block"><span className="label">Name</span><input className="input !w-44" value={name} onChange={(e) => setName(e.target.value)} /></label>
              <button type="button" className="btn-primary btn-sm" disabled={busy || !phone.trim()} onClick={() => run(() => socialCreateLead(t.id, phone, name))}>Create lead</button>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="block"><span className="label">Or link an existing lead</span><input className="input !w-32" value={no} onChange={(e) => setNo(e.target.value)} placeholder="LB-123" /></label>
            <button type="button" className="btn-ghost btn-sm" disabled={busy || !no.trim()} onClick={() => run(() => socialLinkLead(t.id, no))}>Link</button>
          </div>
          <p className="text-xs text-slate-500">Instagram and Messenger don&apos;t share the phone number. Ask the customer for it; a number they type in the chat is filled in for you.</p>
        </>
      )}
      {msg?.error && <div className="text-xs text-red-600">{msg.error}</div>}
      {msg?.ok && <div className="text-xs text-brand-700">{msg.ok}</div>}
    </div>
  );
}

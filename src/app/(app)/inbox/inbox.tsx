"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { sendText, sendFile, sendTemplate, retryMessage, conversationAction, sendReaction } from "@/lib/actions/inbox";
import { changeStatus, addFollowup } from "@/lib/actions/leads";
import { aiSummary, aiSuggestReply } from "@/lib/actions/ai";
import { complaintAction, customerPause } from "@/lib/actions/automation";
import { fmtClock, fmtDateTime, fmtDay } from "@/lib/dates";
import { Modal } from "@/components/ui";

type Conv = {
  id: string; customer_id: string; customer_name: string | null; wa_profile_name: string | null; phone_e164: string; wa_opted_out_at: string | null;
  assignee_id: string | null; assignee_name: string | null; number_id: string; number_label: string; lead_id: string | null; lead_no: number | null;
  lead_status: string | null; status: "open" | "pending" | "resolved"; unread_count: number; last_message_at: string | null; last_message_preview: string | null; last_inbound_at: string | null;
};
type Msg = {
  id: string; direction: "in" | "out"; type: string; body: string | null; media_path: string | null; media_mime: string | null; media_filename: string | null; media_status: string | null;
  template_name: string | null; status: string; error_code: string | null; error_message: string | null; created_at: string; wa_timestamp: string | null; sent_by: string | null;
  wa_message_id: string | null; reply_to_id: string | null; reply_to_wa_id: string | null; customer_reaction: string | null; agent_reaction: string | null;
};
const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const snippet = (m?: Msg) => (m ? m.body ?? (m.template_name ? `Template: ${m.template_name}` : `[${m.type}]`) : "An earlier message");
type Template = { name: string; language: string; category: string | null; waba_id: string; body: string };
type Props = {
  me: { id: string; manager: boolean; canSend: boolean; canTransfer: boolean; canAi: boolean; canComplaints: boolean; canPause: boolean }; initialId: string | null; users: { id: string; name: string }[];
  tags: { id: string; name: string; color: string }[]; statuses: { id: string; name: string; category: string }[];
  numbers: { id: string; label: string; waba_id: string; status: string; last_error: string | null; is_active: boolean }[];
  quick: { shortcut: string; title: string; body: string }[]; templates: Template[];
};

const PAGE = 30;
const name = (c: Pick<Conv, "customer_name" | "wa_profile_name" | "phone_e164">) => c.customer_name || c.wa_profile_name || c.phone_e164;
const windowOpen = (c?: Conv | null) => !!c?.last_inbound_at && Date.now() - new Date(c.last_inbound_at).getTime() < 24 * 3600 * 1000;

export function Inbox(props: Props) {
  const sb = getBrowserClient();
  const [view, setView] = useState<"mine" | "unassigned" | "all">(props.me.manager ? "all" : "mine");
  const [status, setStatus] = useState<"" | "open" | "pending" | "resolved">("open");
  const [numberId, setNumberId] = useState("");
  const [tagId, setTagId] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [list, setList] = useState<Conv[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [selId, setSelId] = useState<string | null>(props.initialId);
  const [selected, setSelected] = useState<Conv | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => { const t = setTimeout(() => setQDebounced(q), 300); return () => clearTimeout(t); }, [q]);

  const loadList = useCallback(async () => {
    const { data, error } = await sb.rpc("lb_list_conversations", {
      p: { status, number_id: numberId, q: qDebounced, mine: view === "mine", unassigned: view === "unassigned", unread: unreadOnly, tag_id: tagId, limit },
    });
    if (error) { setListState("error"); return; }
    setList(data.rows); setTotal(data.total); setUnreadTotal(data.unread_total); setListState("ready");
  }, [sb, status, numberId, qDebounced, view, unreadOnly, tagId, limit]);

  // Selected conversation, fetched directly so it works even when filtered out of the list.
  const loadSelected = useCallback(async () => {
    if (!selId) { setSelected(null); return; }
    const { data: row } = await sb.from("lb_conversations").select("*, customer:lb_customers(name,wa_profile_name,phone_e164,wa_opted_out_at), number:lb_wa_numbers(label), lead:lb_leads(lead_no), assignee:lb_profiles!lb_conversations_assignee_id_fkey(full_name)").eq("id", selId).maybeSingle();
    if (!row) { setSelected(null); return; }
    setSelected({
      ...row, customer_name: row.customer?.name, wa_profile_name: row.customer?.wa_profile_name, phone_e164: row.customer?.phone_e164, wa_opted_out_at: row.customer?.wa_opted_out_at,
      number_label: row.number?.label, lead_no: row.lead?.lead_no ?? null, lead_status: null, assignee_name: row.assignee?.full_name ?? null,
    });
  }, [sb, selId]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadSelected(); }, [loadSelected]);

  // Realtime is a hint only: every event (and every reconnect) triggers a refetch from the DB.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { clearTimeout(t); t = setTimeout(() => setTick((x) => x + 1), 250); };
    const ch = sb.channel("inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "lb_conversations" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "lb_messages" }, bump)
      .subscribe((s: string) => { setLive(s === "SUBSCRIBED"); if (s === "SUBSCRIBED") bump(); });
    const onFocus = () => bump();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    return () => { clearTimeout(t); sb.removeChannel(ch); window.removeEventListener("focus", onFocus); window.removeEventListener("online", onFocus); };
  }, [sb]);
  useEffect(() => { if (tick) { loadList(); loadSelected(); } }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (id: string) => {
    setSelId(id);
    window.history.replaceState(null, "", `/inbox?c=${id}`);
  };

  return (
    <div className="flex h-full bg-white">
      {/* Chat list */}
      <section className={`flex w-full flex-col border-r border-slate-200 md:w-80 md:shrink-0 ${selId ? "max-md:hidden" : ""}`}>
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center justify-between">
            <h1 className="font-semibold text-navy-900">Inbox {unreadTotal > 0 && <span className="badge ml-1 bg-brand-600 text-white">{unreadTotal}</span>}</h1>
            <span className={`text-[11px] ${live ? "text-brand-600" : "text-amber-600"}`} title="Realtime connection">{live ? "● live" : "● reconnecting"}</span>
          </div>
          <input className="input" placeholder="Search name, number, message" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex gap-1 text-xs">
            {(["mine", ...(props.me.manager ? ["unassigned", "all"] : [])] as const).map((v) => (
              <button key={v} onClick={() => setView(v as typeof view)} className={`rounded px-2 py-1 capitalize ${view === v ? "bg-navy-900 text-white" : "bg-slate-100"}`}>{v}</button>
            ))}
            <label className="ml-auto flex items-center gap-1"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread</label>
          </div>
          <div className="flex gap-1 text-xs">
            {(["open", "pending", "resolved", ""] as const).map((s) => (
              <button key={s || "any"} onClick={() => setStatus(s)} className={`rounded px-2 py-1 capitalize ${status === s ? "bg-brand-600 text-white" : "bg-slate-100"}`}>{s || "all"}</button>
            ))}
          </div>
          <div className="flex gap-1">
            <select className="input py-1 text-xs" value={numberId} onChange={(e) => setNumberId(e.target.value)} aria-label="Number"><option value="">All numbers</option>{props.numbers.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select>
            <select className="input py-1 text-xs" value={tagId} onChange={(e) => setTagId(e.target.value)} aria-label="Tag"><option value="">All tags</option>{props.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </div>
          {props.numbers.filter((n) => n.status !== "connected").map((n) => (
            <div key={n.id} className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{n.label}: {n.status}{n.last_error ? ` — ${n.last_error}` : ""}</div>
          ))}
          {props.numbers.length === 0 && <div className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">No WhatsApp number connected or accessible.</div>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {listState === "loading" && <div className="p-4 text-sm text-slate-500">Loading…</div>}
          {listState === "error" && <div className="p-4 text-sm text-red-600">Couldn&apos;t load chats. <button className="underline" onClick={loadList}>Retry</button></div>}
          {listState === "ready" && list.length === 0 && <div className="p-6 text-center text-sm text-slate-500">No conversations</div>}
          {list.map((c) => (
            <button key={c.id} onClick={() => open(c.id)} className={`block w-full border-b px-3 py-2.5 text-left hover:bg-slate-50 ${selId === c.id ? "bg-brand-50" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate text-sm ${c.unread_count ? "font-semibold text-navy-900" : "text-slate-800"}`}>{name(c)}</span>
                <span className="shrink-0 text-[11px] text-slate-400">{c.last_message_at && (new Date(c.last_message_at).toDateString() === new Date().toDateString() ? fmtClock(c.last_message_at) : fmtDay(c.last_message_at))}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-slate-500">{c.last_message_preview}</span>
                {c.unread_count > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">{c.unread_count}</span>}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-400">{c.number_label} · {c.assignee_name ?? "Unassigned"}{c.lead_no ? ` · LB-${c.lead_no}` : ""}</div>
            </button>
          ))}
          {total > list.length && <button className="w-full p-3 text-sm text-brand-700" onClick={() => setLimit((l) => l + PAGE)}>Load more ({total - list.length})</button>}
        </div>
      </section>

      {/* Conversation */}
      {selId && selected ? (
        <>
          <Chat key={selected.id} conv={selected} {...props} tick={tick} onBack={() => { setSelId(null); window.history.replaceState(null, "", "/inbox"); }}
            onDetails={() => setShowDetails((s) => !s)} onChanged={() => { loadList(); loadSelected(); }} />
          <aside className={`w-full shrink-0 overflow-auto border-l border-slate-200 bg-slate-50 lg:block lg:w-80 ${showDetails ? "max-lg:fixed max-lg:inset-0 max-lg:z-40" : "hidden"}`}>
            <Details conv={selected} {...props} tick={tick} onClose={() => setShowDetails(false)} onChanged={() => { loadList(); loadSelected(); }} />
          </aside>
        </>
      ) : (
        <div className="hidden flex-1 items-center justify-center text-sm text-slate-400 md:flex">{selId ? "Loading…" : "Select a conversation"}</div>
      )}
    </div>
  );
}

function Ticks({ m, onRetry }: { m: Msg; onRetry: () => void }) {
  if (m.direction === "in") return null;
  const map: Record<string, string> = { queued: "🕓", sending: "…", sent: "✓", delivered: "✓✓", read: "✓✓" };
  if (m.status === "failed") return (
    <span className="text-red-200">⚠ Failed{m.error_message ? `: ${m.error_message}` : ""} <button className="ml-1 underline" onClick={onRetry}>Retry</button></span>
  );
  return <span className={m.status === "read" ? "text-sky-300" : ""} title={m.status}>{map[m.status] ?? m.status}</span>;
}

function Chat({ conv, me, quick, templates, users, numbers, tick, onBack, onDetails, onChanged }: Props & { conv: Conv; tick: number; onBack: () => void; onDetails: () => void; onChanged: () => void }) {
  const sb = getBrowserClient();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [text, setText] = useState("");
  const [noteMode, setNoteMode] = useState(false);
  const [err, setErr] = useState<string>();
  const [sending, setSending] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [tpl, setTpl] = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const clientId = useRef<string>(crypto.randomUUID()); // stable per draft => retries are idempotent
  // AI drafts arrive from the details pane; the agent reviews/edits before sending.
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<{ conv: string; text: string }>).detail; if (d.conv === conv.id) { setNoteMode(false); setText(d.text); } };
    window.addEventListener("lb:draft", h);
    return () => window.removeEventListener("lb:draft", h);
  }, [conv.id]);

  const load = useCallback(async (older?: string) => {
    let qy = sb.from("lb_messages").select("id,direction,type,body,media_path,media_mime,media_filename,media_status,template_name,status,error_code,error_message,created_at,wa_timestamp,sent_by,wa_message_id,reply_to_id,reply_to_wa_id,customer_reaction,agent_reaction")
      .eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(50);
    if (older) qy = qy.lt("created_at", older);
    const { data, error } = await qy;
    if (error) { setState("error"); return; }
    const rows = (data as Msg[]).reverse();
    setHasMore(data.length === 50);
    setMsgs((cur) => (older ? [...rows, ...cur] : rows));
    setState("ready");
  }, [sb, conv.id]);

  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => { if (conv.unread_count > 0) conversationAction(conv.id, "read").then(onChanged); }, [conv.id, conv.unread_count]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastId = msgs[msgs.length - 1]?.id;
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [lastId]);

  const isOpenWindow = windowOpen(conv);
  const number = numbers.find((n) => n.id === conv.number_id);
  const qr = text.startsWith("/") ? quick.filter((x) => x.shortcut.startsWith(text.slice(1).toLowerCase())) : [];

  const submit = async () => {
    if (!text.trim() || sending) return;
    setSending(true); setErr(undefined);
    const r = noteMode ? await conversationAction(conv.id, "note", { body: text }) : await sendText(conv.id, clientId.current, text, replyTo?.id);
    setSending(false);
    if (r.error && !r.ok) { setErr(r.error); return; }
    if (r.error) setErr(r.error);
    setText(""); setReplyTo(null); clientId.current = crypto.randomUUID();
    load(); onChanged();
  };

  const upload = async (f: File) => {
    setSending(true); setErr(undefined);
    const fd = new FormData();
    fd.set("conversation_id", conv.id); fd.set("client_id", crypto.randomUUID()); fd.set("file", f); fd.set("caption", text); if (replyTo) fd.set("reply_to", replyTo.id);
    const r = await sendFile(fd);
    setSending(false);
    if (r.error) setErr(r.error); else { setText(""); setReplyTo(null); load(); onChanged(); }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <button className="md:hidden" onClick={onBack} aria-label="Back">←</button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-navy-900">{name(conv)}</div>
          <div className="truncate text-xs text-slate-500">{conv.phone_e164} · {conv.number_label} · {conv.assignee_name ?? "Unassigned"}
            {conv.wa_opted_out_at && <span className="ml-1 text-red-600">· opted out</span>}</div>
        </div>
        <select className="input w-auto py-1 text-xs" value={conv.status} aria-label="Conversation status"
          onChange={async (e) => { const r = await conversationAction(conv.id, "status", { status: e.target.value }); if (r.error) setErr(r.error); onChanged(); }}>
          <option value="open">Open</option><option value="pending">Pending</option><option value="resolved">Resolved</option>
        </select>
        {me.canTransfer && <button className="btn-ghost btn-sm" onClick={() => setTransfer(true)}>Transfer</button>}
        <button className="btn-ghost btn-sm lg:hidden" onClick={onDetails}>Details</button>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-[#eef2f5] p-3">
        {hasMore && <div className="text-center"><button className="text-xs text-brand-700" onClick={() => load(msgs[0]?.created_at)}>Load older messages</button></div>}
        {state === "loading" && <div className="text-center text-sm text-slate-500">Loading…</div>}
        {state === "error" && <div className="text-center text-sm text-red-600">Couldn&apos;t load messages. <button className="underline" onClick={() => load()}>Retry</button></div>}
        {state === "ready" && msgs.length === 0 && <div className="text-center text-sm text-slate-500">No messages yet.</div>}
        {msgs.map((m) => (
          <div key={m.id} className={`group flex items-center gap-1 ${m.direction === "out" ? "flex-row-reverse" : ""}`}>
            <div className={`relative max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${m.direction === "out" ? (m.status === "failed" ? "bg-red-600 text-white" : "bg-navy-800 text-white") : "bg-white text-slate-900"}`}>
              {(m.reply_to_id || m.reply_to_wa_id) && (
                <div className="mb-1 border-l-2 border-brand-500 bg-black/5 px-2 py-1 text-xs opacity-80 line-clamp-2">{snippet(msgs.find((x) => x.id === m.reply_to_id))}</div>
              )}
              {m.template_name && <div className="mb-1 text-[11px] opacity-70">Template: {m.template_name}</div>}
              {m.media_path && m.type === "image" && <a href={`/api/media/${m.id}`} target="_blank" rel="noreferrer"><img src={`/api/media/${m.id}`} alt={m.media_filename ?? "image"} className="mb-1 max-h-64 rounded" /></a>}
              {m.media_path && m.type !== "image" && <a className="mb-1 block underline" href={`/api/media/${m.id}?download=1`}>📎 {m.media_filename ?? m.type}</a>}
              {!m.media_path && m.media_status === "pending" && <div className="text-xs italic opacity-70">Downloading attachment…</div>}
              {m.media_status === "failed" && m.direction === "in" && <div className="text-xs italic text-red-600">Attachment could not be downloaded (will retry).</div>}
              {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
              <div className="mt-1 flex items-center justify-end gap-2 text-[10px] opacity-75">
                <span>{fmtDateTime(m.wa_timestamp ?? m.created_at)}</span>
                <Ticks m={m} onRetry={async () => {
                  if (m.error_code === "unknown" && !confirm("The previous attempt may have been delivered. Retry anyway?")) return;
                  const r = await retryMessage(m.id); if (r.error) setErr(r.error); load();
                }} />
              </div>
              {(m.customer_reaction || m.agent_reaction) && (
                <div className={`absolute -bottom-3 ${m.direction === "out" ? "left-2" : "right-2"} rounded-full border bg-white px-1.5 text-xs text-slate-900 shadow-sm`}
                  title={[m.customer_reaction && "Customer", m.agent_reaction && "You"].filter(Boolean).join(" & ")}>{m.customer_reaction}{m.agent_reaction}</div>
              )}
            </div>
            {me.canSend && isOpenWindow && m.status !== "failed" && (
              <div className="relative flex gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                <button className="rounded px-1 text-xs text-slate-500 hover:bg-white" title="Reply" onClick={() => setReplyTo(m)}>↩</button>
                {m.wa_message_id && <button className="rounded px-1 text-xs text-slate-500 hover:bg-white" title="React" onClick={() => setPicker(picker === m.id ? null : m.id)}>☺</button>}
                {picker === m.id && (
                  <div className={`absolute bottom-full z-10 mb-1 flex gap-1 rounded-full border bg-white px-2 py-1 shadow ${m.direction === "out" ? "right-0" : "left-0"}`}>
                    {REACTIONS.map((e) => <button key={e} className="text-base hover:scale-125" onClick={async () => { setPicker(null); const r = await sendReaction(m.id, e); if (r.error) setErr(r.error); load(); }}>{e}</button>)}
                    {m.agent_reaction && <button className="text-xs text-slate-500" onClick={async () => { setPicker(null); const r = await sendReaction(m.id, ""); if (r.error) setErr(r.error); load(); }}>✕</button>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <footer className="border-t p-2">
        {err && <div role="alert" className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{err}</div>}
        {!number?.is_active && <div className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">This business number is disabled; sending is blocked.</div>}
        {!me.canSend && !noteMode ? (
          <div className="flex items-center gap-2 text-sm text-slate-600">You don&apos;t have permission to send WhatsApp messages. <button className="btn-ghost btn-sm" onClick={() => setNoteMode(true)}>Internal note</button></div>
        ) : !isOpenWindow && !noteMode ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">24-hour window {conv.last_inbound_at ? "closed" : "not opened by customer"} — only approved templates can be sent.</span>
            <button className="btn-primary btn-sm" onClick={() => setTpl(true)}>Send template</button>
            <button className="btn-ghost btn-sm" onClick={() => setNoteMode(true)}>Internal note</button>
          </div>
        ) : (
          <div className="relative">
            {qr.length > 0 && (
              <div className="absolute bottom-full mb-1 max-h-48 w-full overflow-auto rounded border bg-white shadow">
                {qr.map((x) => <button key={x.shortcut} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => setText(x.body)}><span className="font-mono text-brand-700">/{x.shortcut}</span> {x.title}</button>)}
              </div>
            )}
            {replyTo && !noteMode && (
              <div className="mb-1 flex items-center gap-2 rounded border-l-4 border-brand-500 bg-slate-50 px-2 py-1 text-xs">
                <span className="min-w-0 flex-1 truncate"><b>Replying to {replyTo.direction === "in" ? name(conv) : "you"}:</b> {snippet(replyTo)}</span>
                <button onClick={() => setReplyTo(null)} aria-label="Cancel reply">✕</button>
              </div>
            )}
            <div className={`flex items-end gap-2 rounded-lg border p-1 ${noteMode ? "border-amber-300 bg-amber-50" : "border-slate-300"}`}>
              {!noteMode && <button className="px-2 py-1 text-lg text-slate-500" title="Attach" onClick={() => fileRef.current?.click()} disabled={sending}>📎</button>}
              <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
              <textarea className="max-h-40 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none" rows={1} value={text}
                placeholder={noteMode ? "Internal note (not sent to customer)" : "Type a message — “/” for quick replies"}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
              <button className={noteMode ? "btn btn-sm bg-amber-500 text-white" : "btn-primary btn-sm"} disabled={sending || !text.trim()} onClick={submit}>{sending ? "…" : noteMode ? "Add note" : "Send"}</button>
            </div>
            <div className="mt-1 flex gap-3 text-[11px] text-slate-500">
              <label className="flex items-center gap-1"><input type="checkbox" checked={noteMode} onChange={(e) => setNoteMode(e.target.checked)} /> Internal note</label>
              {isOpenWindow && <span>Window open until {fmtDateTime(new Date(new Date(conv.last_inbound_at!).getTime() + 86400000).toISOString())}</span>}
              {!isOpenWindow && <button className="text-brand-700" onClick={() => setTpl(true)}>Send template</button>}
            </div>
          </div>
        )}
      </footer>

      <TransferModal open={transfer} onClose={() => setTransfer(false)} conv={conv} users={users} meId={me.id} onDone={onChanged} />
      <TemplateModal open={tpl} onClose={() => setTpl(false)} conv={conv} templates={templates.filter((t) => t.waba_id === number?.waba_id)}
        onSent={() => { load(); onChanged(); }} />
    </section>
  );
}

function TransferModal({ open, onClose, conv, users, meId, onDone }: { open: boolean; onClose: () => void; conv: Conv; users: { id: string; name: string }[]; meId: string; onDone: () => void }) {
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [sync, setSync] = useState(true);
  const [err, setErr] = useState<string>();
  return (
    <Modal open={open} onClose={onClose} title="Transfer chat">
      <div className="space-y-3">
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose user…</option>{users.filter((u) => u.id !== conv.assignee_id).map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === meId ? " (me)" : ""}</option>)}</select>
        <input className="input" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        {conv.lead_id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> Also transfer lead LB-{conv.lead_no} (keeps owner and chat in sync)</label>}
        {err && <div className="text-sm text-red-600">{err}</div>}
        <button className="btn-primary" disabled={!to || (!!conv.assignee_id && !reason.trim())} onClick={async () => {
          const r = await conversationAction(conv.id, "transfer", { to_user_id: to, reason, sync_lead: sync });
          if (r.error) setErr(r.error); else { onClose(); onDone(); }
        }}>Transfer</button>
        {!!conv.assignee_id && !reason.trim() && <p className="text-xs text-slate-500">A reason is required when reassigning.</p>}
      </div>
    </Modal>
  );
}

function TemplateModal({ open, onClose, conv, templates, onSent }: { open: boolean; onClose: () => void; conv: Conv; templates: Template[]; onSent: () => void }) {
  const [key, setKey] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const clientId = useRef(crypto.randomUUID());
  const t = templates.find((x) => `${x.name}|${x.language}` === key);
  const count = useMemo(() => (t ? new Set(t.body.match(/\{\{\d+\}\}/g) ?? []).size : 0), [t]);
  const blocked = t?.category?.toUpperCase() === "MARKETING" && !!conv.wa_opted_out_at;
  return (
    <Modal open={open} onClose={onClose} title="Send approved template">
      {templates.length === 0 ? <p className="text-sm text-slate-500">No approved templates for this number. Ask an admin to sync templates.</p> : (
        <div className="space-y-3">
          <select className="input" value={key} onChange={(e) => { setKey(e.target.value); setParams([]); }}>
            <option value="">Choose template…</option>
            {templates.map((x) => <option key={`${x.name}|${x.language}`} value={`${x.name}|${x.language}`}>{x.name} ({x.language}) · {x.category}</option>)}
          </select>
          {t && <div className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-sm text-slate-700">{t.body}</div>}
          {Array.from({ length: count }).map((_, i) => (
            <input key={i} className="input" placeholder={`Value for {{${i + 1}}}`} value={params[i] ?? ""} onChange={(e) => setParams((p) => { const n = [...p]; n[i] = e.target.value; return n; })} />
          ))}
          {blocked && <p className="text-sm text-red-600">Customer opted out — marketing templates are blocked.</p>}
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button className="btn-primary" disabled={!t || blocked || busy || params.filter(Boolean).length < count} onClick={async () => {
            setBusy(true);
            const r = await sendTemplate(conv.id, clientId.current, t!.name, t!.language, params);
            setBusy(false);
            if (r.error && !r.ok) { setErr(r.error); return; }
            clientId.current = crypto.randomUUID(); onClose(); onSent();
          }}>{busy ? "Sending…" : "Send"}</button>
        </div>
      )}
    </Modal>
  );
}

type Note = { id: string; body: string; created_at: string; author_id: string | null };
function Details({ conv, me, users, tags, statuses, tick, onClose, onChanged }: Props & { conv: Conv; tick: number; onClose: () => void; onChanged: () => void }) {
  const sb = getBrowserClient();
  const [lead, setLead] = useState<{ id: string; lead_no: number; status_id: string; owner_id: string | null; next_followup_at: string | null } | null>(null);
  const [convTags, setConvTags] = useState<string[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [msg, setMsg] = useState<string>();
  const [due, setDue] = useState("");
  const uName = new Map(users.map((u) => [u.id, u.name]));

  const load = useCallback(async () => {
    const [l, t, n] = await Promise.all([
      conv.lead_id ? sb.from("lb_leads").select("id,lead_no,status_id,owner_id,next_followup_at").eq("id", conv.lead_id).maybeSingle() : Promise.resolve({ data: null }),
      sb.from("lb_conversation_tags").select("tag_id").eq("conversation_id", conv.id),
      sb.from("lb_notes").select("id,body,created_at,author_id").eq("customer_id", conv.customer_id).order("created_at", { ascending: false }).limit(30),
    ]);
    setLead(l.data); setConvTags((t.data ?? []).map((x: { tag_id: string }) => x.tag_id)); setNotes(n.data ?? []);
  }, [sb, conv.id, conv.lead_id, conv.customer_id]);
  useEffect(() => { load(); }, [load, tick]);

  const act = async (fn: () => Promise<{ error?: string } | undefined>, ok: string) => {
    const r = await fn(); setMsg(r?.error ?? ok); load(); onChanged();
  };

  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="flex items-center justify-between lg:hidden"><b>Details</b><button onClick={onClose} aria-label="Close">✕</button></div>
      <div>
        <div className="font-semibold text-navy-900">{name(conv)}</div>
        <div className="text-slate-600">{conv.phone_e164}</div>
        <Link className="text-xs text-brand-700 hover:underline" href={`/customers/${conv.customer_id}`}>Customer 360 →</Link>
      </div>
      {msg && <div className="rounded bg-slate-100 px-2 py-1 text-xs">{msg}</div>}
      <section>
        <h3 className="label">Lead</h3>
        {lead ? (
          <div className="space-y-2">
            <Link className="font-medium text-brand-700 hover:underline" href={`/leads/${lead.id}`}>LB-{lead.lead_no}</Link>
            <span className="ml-2 text-xs text-slate-500">{lead.owner_id ? uName.get(lead.owner_id) ?? "Owner" : "Unassigned"}</span>
            <select className="input" value={lead.status_id} aria-label="Lead status" onChange={(e) => {
              const st = statuses.find((s) => s.id === e.target.value);
              let reason = "";
              if (st && (st.category === "lost" || st.category === "invalid")) { reason = prompt(`Reason for ${st.name}?`) ?? ""; if (!reason.trim()) return; }
              const fd = new FormData(); fd.set("id", lead.id); fd.set("status_id", e.target.value); fd.set("reason", reason);
              act(() => changeStatus(undefined, fd), "Status updated");
            }}>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="text-xs text-slate-500">Next follow-up: {fmtDateTime(lead.next_followup_at)}</div>
            <div className="flex gap-1">
              <input className="input py-1 text-xs" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Follow-up time" />
              <button className="btn-ghost btn-sm" disabled={!due} onClick={() => {
                const fd = new FormData(); fd.set("id", lead.id); fd.set("due_at", due); fd.set("note", "From chat");
                act(() => addFollowup(undefined, fd), "Follow-up scheduled"); setDue("");
              }}>Add</button>
            </div>
            <p className="text-[11px] text-slate-400">Sales status is separate from the chat status (Open/Pending/Resolved). Times in IST.</p>
          </div>
        ) : (
          <button className="btn-primary btn-sm" onClick={() => act(() => conversationAction(conv.id, "create_lead"), "Lead linked")}>Create / link lead</button>
        )}
      </section>
      <section>
        <h3 className="label">Tags</h3>
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => {
            const on = convTags.includes(t.id);
            return <button key={t.id} className={`badge border ${on ? "text-white" : "bg-white text-slate-600"}`} style={on ? { background: t.color, borderColor: t.color } : {}}
              onClick={() => act(() => conversationAction(conv.id, "tags", { tag_ids: on ? convTags.filter((x) => x !== t.id) : [...convTags, t.id] }), "Tags saved")}>{t.name}</button>;
          })}
          {tags.length === 0 && <span className="text-xs text-slate-400">No tags defined.</span>}
        </div>
      </section>
      {me.canAi && <AiPanel convId={conv.id} />}
      <CustomerControls conv={conv} canComplaints={me.canComplaints} canPause={me.canPause} onDone={() => { load(); onChanged(); }} tick={tick} />
      <section>
        <h3 className="label">Internal notes</h3>
        <ul className="space-y-2">
          {notes.map((n) => <li key={n.id} className="rounded bg-amber-50 p-2"><div className="whitespace-pre-wrap">{n.body}</div><div className="text-[11px] text-slate-500">{n.author_id ? uName.get(n.author_id) : ""} · {fmtDateTime(n.created_at)}</div></li>)}
          {notes.length === 0 && <li className="text-xs text-slate-400">No notes. Use “Internal note” in the composer.</li>}
        </ul>
      </section>
    </div>
  );
}

function AiPanel({ convId }: { convId: string }) {
  const [busy, setBusy] = useState<"" | "sum" | "sug">("");
  const [summary, setSummary] = useState<string>();
  const [draft, setDraft] = useState<{ text: string; kb: { id: string; title: string }[] }>();
  const [err, setErr] = useState<string>();
  return (
    <section>
      <h3 className="label">AI assist <span className="font-normal text-slate-400">— drafts only, you approve</span></h3>
      <div className="flex gap-1">
        <button className="btn-ghost btn-sm" disabled={!!busy} onClick={async () => { setBusy("sum"); setErr(undefined); const r = await aiSummary(convId); setBusy(""); if (r.error) setErr(r.error); else setSummary(r.text); }}>
          {busy === "sum" ? "Summarising…" : "Summarise"}</button>
        <button className="btn-ghost btn-sm" disabled={!!busy} onClick={async () => { setBusy("sug"); setErr(undefined); const r = await aiSuggestReply(convId); setBusy(""); if (r.error) setErr(r.error); else setDraft({ text: r.text!, kb: r.knowledge ?? [] }); }}>
          {busy === "sug" ? "Drafting…" : "Suggest reply"}</button>
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {summary && <div className="mt-2 whitespace-pre-wrap rounded bg-white p-2 text-xs text-slate-700 shadow-sm">{summary}</div>}
      {draft && (
        <div className="mt-2 rounded border border-brand-100 bg-white p-2 text-xs">
          <div className="whitespace-pre-wrap text-slate-800">{draft.text}</div>
          <div className="mt-1 text-[11px] text-slate-500">{draft.kb.length ? `Based on: ${draft.kb.map((k) => k.title).join(", ")}` : "No approved knowledge matched — check facts before sending."}</div>
          <button className="btn-primary btn-sm mt-1" onClick={() => window.dispatchEvent(new CustomEvent("lb:draft", { detail: { conv: convId, text: draft.text } }))}>Use as draft</button>
        </div>
      )}
    </section>
  );
}

function CustomerControls({ conv, canComplaints, canPause, onDone, tick }: { conv: Conv; canComplaints: boolean; canPause: boolean; onDone: () => void; tick: number }) {
  const sb = getBrowserClient();
  const [open, setOpen] = useState<{ id: string; note: string | null; matched: string | null }[]>([]);
  const [pausedUntil, setPausedUntil] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>();
  const load = useCallback(async () => {
    const [{ data: k }, { data: c }] = await Promise.all([
      sb.from("lb_complaints").select("id,note,matched").eq("customer_id", conv.customer_id).eq("status", "open"),
      sb.from("lb_customers").select("automation_paused_until").eq("id", conv.customer_id).maybeSingle(),
    ]);
    setOpen(k ?? []); setPausedUntil(c?.automation_paused_until ?? null);
  }, [sb, conv.customer_id]);
  useEffect(() => { load(); }, [load, tick]);
  const paused = pausedUntil && new Date(pausedUntil) > new Date();
  return (
    <section className="space-y-2">
      {canComplaints && (
        <div>
          <h3 className="label">Complaints</h3>
          {open.map((k) => (
            <div key={k.id} className="mb-1 rounded bg-red-50 p-2 text-xs text-red-800">
              {k.note ?? `Keyword: “${k.matched}”`}
              <button className="ml-2 underline" onClick={async () => { const note = prompt("Resolution note?") ?? ""; const r = await complaintAction(conv.id, "resolve", note, k.id); setMsg(r.error ?? "Resolved (marketing suppression stays until removed in Consent)."); load(); onDone(); }}>Resolve</button>
            </div>
          ))}
          <button className="btn-ghost btn-sm" onClick={async () => { const note = prompt("Describe the complaint"); if (!note) return; const r = await complaintAction(conv.id, "raise", note); setMsg(r.error ?? "Complaint raised: marketing suppressed and journeys stopped."); load(); onDone(); }}>Raise complaint</button>
        </div>
      )}
      {canPause && (
        <div>
          <h3 className="label">Automation for this customer</h3>
          {paused ? (
            <button className="btn-ghost btn-sm" onClick={async () => { const r = await customerPause(conv.customer_id, null); setMsg(r.error ?? "Automation resumed."); load(); }}>Resume (paused until {fmtDateTime(pausedUntil)})</button>
          ) : (
            <span className="flex gap-1">
              {[["1 day", 1], ["7 days", 7], ["Until resumed", 3650]].map(([l, d]) => (
                <button key={l as string} className="btn-ghost btn-sm" onClick={async () => { const r = await customerPause(conv.customer_id, new Date(Date.now() + (d as number) * 86400000).toISOString()); setMsg(r.error ?? "Automation paused for this customer."); load(); }}>Pause {l}</button>
              ))}
            </span>
          )}
        </div>
      )}
      {msg && <p className="text-xs text-slate-600">{msg}</p>}
    </section>
  );
}

"use client";
// Team notes inside a chat: amber bubbles in the chat timeline, @mention picker in
// the note composer, "Mentions" list for the notes that mention me, and a notes-only
// view for a teammate who was mentioned but cannot open the chat itself.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { addChatNote } from "@/lib/actions/inbox";
import { fmtDateTime } from "@/lib/dates";
import { Modal } from "@/components/ui";

export type ChatNote = { id: string; body: string; created_at: string; author_id: string | null; mentions: string[] | null };
type User = { id: string; name: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Users whose "@Name" is still in the text (so deleting the text removes the mention). */
export function mentionedIds(text: string, users: User[], meId: string) {
  return users.filter((u) => u.id !== meId && u.name && text.includes(`@${u.name}`)).map((u) => u.id);
}

/** Note body with @Name highlighted. */
export function NoteText({ body, users, meId }: { body: string; users: User[]; meId: string }) {
  const names = useMemo(() => users.map((u) => u.name).filter(Boolean).sort((a, b) => b.length - a.length), [users]);
  if (!names.length) return <>{body}</>;
  const re = new RegExp(`(@(?:${names.map(esc).join("|")}))`, "g");
  const me = users.find((u) => u.id === meId)?.name;
  return (
    <>
      {body.split(re).map((part, i) =>
        i % 2 === 1
          ? <span key={i} className={`rounded px-0.5 font-semibold ${part === `@${me}` ? "bg-amber-300 text-amber-950" : "text-amber-800"}`}>{part}</span>
          : <span key={i}>{part}</span>,
      )}
    </>
  );
}

/** One team note in the chat timeline. */
export function NoteBubble({ n, users, meId }: { n: ChatNote; users: User[]; meId: string }) {
  const author = users.find((u) => u.id === n.author_id)?.name ?? "Teammate";
  const forMe = (n.mentions ?? []).includes(meId);
  return (
    <div className="flex justify-center">
      <div className={`w-full max-w-[85%] rounded-lg border px-3 py-2 text-sm shadow-sm ${forMe ? "border-amber-400 bg-amber-100" : "border-amber-200 bg-amber-50"}`}>
        <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-amber-800">
          <span aria-hidden>🔒</span> Team note · {n.author_id === meId ? "You" : author}
          <span className="ml-auto font-normal text-amber-700/80">{fmtDateTime(n.created_at)}</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-slate-800"><NoteText body={n.body} users={users} meId={meId} /></div>
        <div className="mt-0.5 text-[10px] text-amber-700/70">Only your team sees this. Not sent to the customer.</div>
      </div>
    </div>
  );
}

/**
 * @mention support for a textarea: returns the dropdown to render above it and an
 * onKeyDown handler. Typing "@" + letters filters teammates; Enter/Tab/click inserts "@Name ".
 */
export function useMentionPicker(opts: { enabled: boolean; text: string; setText: (s: string) => void; users: User[]; meId: string; areaRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const { enabled, text, setText, users, meId, areaRef } = opts;
  const [caret, setCaret] = useState(0);
  const [idx, setIdx] = useState(0);
  const [closed, setClosed] = useState(false);
  const before = text.slice(0, caret);
  const m = enabled ? before.match(/(^|\s)@([^\s@]{0,30})$/u) : null;
  const query = m ? m[2].toLowerCase() : null;
  const matches = useMemo(
    () => (query === null ? [] : users.filter((u) => u.id !== meId && u.name.toLowerCase().includes(query)).slice(0, 8)),
    [query, users, meId],
  );
  const open = !closed && query !== null && matches.length > 0;
  useEffect(() => { setIdx(0); setClosed(false); }, [query]);

  const track = () => setCaret(areaRef.current?.selectionStart ?? text.length);
  const pick = (u: User) => {
    const start = before.length - (m?.[2].length ?? 0) - 1; // position of "@"
    const next = `${text.slice(0, start)}@${u.name} ${text.slice(caret)}`;
    setText(next);
    const pos = start + u.name.length + 2;
    requestAnimationFrame(() => { const a = areaRef.current; if (a) { a.focus(); a.setSelectionRange(pos, pos); setCaret(pos); } });
  };
  /** Returns true when the key was used by the picker. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => (i + 1) % matches.length); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => (i - 1 + matches.length) % matches.length); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[idx]); return true; }
    if (e.key === "Escape") { e.preventDefault(); setClosed(true); return true; }
    return false;
  };
  const insertAt = () => {
    const a = areaRef.current;
    const pos = a?.selectionStart ?? text.length;
    const pre = text.slice(0, pos);
    const add = pre && !/\s$/.test(pre) ? " @" : "@";
    setText(pre + add + text.slice(pos));
    requestAnimationFrame(() => { if (a) { a.focus(); const p = pos + add.length; a.setSelectionRange(p, p); setCaret(p); } });
  };
  const dropdown = open ? (
    <div className="absolute bottom-full z-20 mb-1 max-h-56 w-64 overflow-auto rounded-lg border border-amber-200 bg-white py-1 shadow-lg" role="listbox" aria-label="Mention a teammate">
      <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Mention a teammate</div>
      {matches.map((u, i) => (
        <button key={u.id} type="button" role="option" aria-selected={i === idx}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === idx ? "bg-amber-50" : "hover:bg-slate-50"}`}
          onMouseDown={(e) => { e.preventDefault(); pick(u); }}>
          <span className="grid h-6 w-6 place-items-center rounded-full bg-amber-200 text-[11px] font-bold text-amber-900">{u.name.slice(0, 1).toUpperCase()}</span>
          {u.name}
        </button>
      ))}
    </div>
  ) : null;
  return { dropdown, onKeyDown, track, insertAt };
}

type MentionRow = { id: string; body: string; created_at: string; author_id: string | null; conversation_id: string | null; subject: string | null };

/** "@ Mentions" button for the inbox list: unread count + list of notes that mention me. */
export function MentionsButton({ meId, users, onOpen }: { meId: string; users: User[]; onOpen: (convId: string) => void }) {
  const sb = getBrowserClient();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<MentionRow[] | null>(null);
  const count = useCallback(async () => {
    const { count: c } = await sb.from("lb_notifications").select("id", { count: "exact", head: true }).eq("user_id", meId).eq("type", "mention").is("read_at", null);
    setUnread(c ?? 0);
  }, [sb, meId]);
  useEffect(() => {
    count();
    const ch = sb.channel(`mentions-${meId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lb_notifications", filter: `user_id=eq.${meId}` }, () => count())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [sb, meId, count]);
  const show = async () => {
    setOpen(true); setRows(null);
    const { data } = await sb.from("lb_notes").select("id,body,created_at,author_id,conversation_id,subject").contains("mentions", [meId]).order("created_at", { ascending: false }).limit(50);
    setRows((data as MentionRow[]) ?? []);
    if (unread) {
      await sb.from("lb_notifications").update({ read_at: new Date().toISOString() }).eq("user_id", meId).eq("type", "mention").is("read_at", null);
      setUnread(0);
    }
  };
  const uName = (id: string | null) => users.find((u) => u.id === id)?.name ?? "Teammate";
  return (
    <>
      <button type="button" onClick={show} title="Team notes that mention you"
        className={`rounded px-2 py-1 text-xs font-medium ${unread ? "bg-amber-400 text-amber-950" : "bg-amber-50 text-amber-800"}`}>
        @ Mentions{unread > 0 && <span className="ml-1 rounded-full bg-white/80 px-1.5 text-[10px] font-bold">{unread}</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Notes that mention you">
        <div className="max-h-[60vh] space-y-2 overflow-auto">
          {rows === null && <p className="text-sm text-slate-500">Loading…</p>}
          {rows?.length === 0 && <p className="text-sm text-slate-500">Nobody has mentioned you yet. Teammates can type @your name in a chat&apos;s team note.</p>}
          {rows?.map((r) => (
            <button key={r.id} type="button" className="block w-full rounded-lg border border-amber-200 bg-amber-50 p-2 text-left text-sm hover:border-amber-400"
              onClick={() => { if (r.conversation_id) { setOpen(false); onOpen(r.conversation_id); } }}>
              <div className="flex items-center gap-2 text-[11px] text-amber-800">
                <b>{uName(r.author_id)}</b> · {r.subject ?? "Chat"}<span className="ml-auto text-amber-700/70">{fmtDateTime(r.created_at)}</span>
              </div>
              <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-slate-800"><NoteText body={r.body} users={users} meId={meId} /></div>
              <div className="mt-1 text-[11px] font-medium text-brand-700">Open chat →</div>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}

/**
 * Shown when I was mentioned in a chat I cannot open (not assigned to me): the team
 * notes only, plus a box to reply with a note. Customer messages stay hidden.
 */
export function NotesOnly({ convId, users, meId, tick, onBack }: { convId: string; users: User[]; meId: string; tick: number; onBack: () => void }) {
  const sb = getBrowserClient();
  const [notes, setNotes] = useState<(ChatNote & { subject: string | null })[] | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const picker = useMentionPicker({ enabled: true, text, setText, users, meId, areaRef });
  const load = useCallback(async () => {
    const { data } = await sb.from("lb_notes").select("id,body,created_at,author_id,mentions,subject").eq("conversation_id", convId).order("created_at").limit(200);
    setNotes((data as (ChatNote & { subject: string | null })[]) ?? []);
  }, [sb, convId]);
  useEffect(() => { load(); }, [load, tick]);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [notes?.length]);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(undefined);
    const r = await addChatNote(convId, text, mentionedIds(text, users, meId));
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    setText(""); load();
  };
  if (notes === null) return <div className="hidden flex-1 items-center justify-center text-sm text-slate-400 md:flex">Loading…</div>;
  if (notes.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-500">
        This chat is not assigned to you, so you can&apos;t open it.
        <button className="btn-ghost btn-sm" onClick={onBack}>Back to inbox</button>
      </div>
    );
  }
  const subject = notes.find((n) => n.subject)?.subject ?? "Chat";
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <button className="md:hidden" onClick={onBack} aria-label="Back">←</button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-navy-900">{subject} · team notes</div>
          <div className="truncate text-xs text-slate-500">You were mentioned here. The chat belongs to a teammate, so only the team notes are shown.</div>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-[#eef2f5] p-3">
        {notes.map((n) => <NoteBubble key={n.id} n={n} users={users} meId={meId} />)}
        <div ref={endRef} />
      </div>
      <footer className="border-t p-2">
        {err && <div role="alert" className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{err}</div>}
        <div className="relative">
          {picker.dropdown}
          <div className="flex items-end gap-2 rounded-lg border border-amber-300 bg-amber-50 p-1">
            <button type="button" className="px-2 py-1 font-bold text-amber-700" title="Mention a teammate" onClick={picker.insertAt}>@</button>
            <textarea ref={areaRef} className="max-h-40 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none" rows={1} value={text}
              placeholder="Reply with a team note — type @ to mention" onChange={(e) => { setText(e.target.value); picker.track(); }} onSelect={picker.track} onClick={picker.track}
              onKeyDown={(e) => { if (picker.onKeyDown(e)) return; if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
            <button className="btn btn-sm bg-amber-500 text-white" disabled={busy || !text.trim()} onClick={submit}>{busy ? "…" : "Add note"}</button>
          </div>
        </div>
      </footer>
    </section>
  );
}

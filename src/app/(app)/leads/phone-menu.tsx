"use client";
import { useEffect, useRef, useState } from "react";
import { openLeadChat } from "@/lib/actions/leads";
import { openChatPopup } from "./chat-popup-host";
import { dialNumber } from "@/components/call-sync";

// ⋮ menu next to a lead's mobile number: Call, Chat (popup with the CRM chat), WhatsApp, Copy.
// The menu is position:fixed so the table's horizontal scroll box cannot clip it.
export function PhoneMenu({ leadId, phone }: { leadId: string; phone: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const digits = phone.replace(/\D/g, "");

  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", esc); };
  }, [pos]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 4000); return () => clearTimeout(t); }, [note]);

  const toggle = () => {
    if (pos) { setPos(null); return; }
    const r = btn.current!.getBoundingClientRect();
    const h = 176;
    setPos({ left: Math.min(r.left, window.innerWidth - 176), top: r.bottom + h > window.innerHeight ? r.top - h - 4 : r.bottom + 4 });
  };
  const chat = async () => {
    setBusy(true);
    const res = await openLeadChat(leadId);
    setBusy(false); setPos(null);
    if (res.error || !res.id) setNote(res.error ?? "Chat not found"); else openChatPopup(res.id);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(phone); setNote("Number copied"); } catch { setNote(phone); }
    setPos(null);
  };
  const item = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-navy-900 hover:bg-slate-100";

  return (
    <>
      <button ref={btn} type="button" onClick={toggle} aria-label={`Contact options for ${phone}`} aria-expanded={!!pos}
        className={`ml-1 inline-grid h-5 w-5 place-items-center rounded ${pos ? "bg-violet-700 text-white" : "bg-violet-600/90 text-white hover:bg-violet-700"}`}>
        <svg viewBox="0 0 4 14" className="h-3 w-1"><circle cx="2" cy="2" r="1.4" fill="currentColor" /><circle cx="2" cy="7" r="1.4" fill="currentColor" /><circle cx="2" cy="12" r="1.4" fill="currentColor" /></svg>
      </button>
      {pos && (
        <div ref={menu} role="menu" style={{ top: pos.top, left: pos.left }} className="fixed z-50 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          <a role="menuitem" href={`tel:+${digits}`} className={item} onClick={(e) => { e.preventDefault(); setPos(null); dialNumber(phone); }}>
            <Svg d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" className="text-green-600" />Call
          </a>
          <button role="menuitem" type="button" className={item} onClick={chat} disabled={busy}>
            <Svg d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" className="text-sky-600" />{busy ? "Opening…" : "Chat"}
          </button>
          <a role="menuitem" href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" className={item} onClick={() => setPos(null)}>
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-green-500" fill="currentColor" aria-hidden><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z" /></svg>WhatsApp
          </a>
          <button role="menuitem" type="button" className={item} onClick={copy}>
            <Svg d="M9 9h11v11H9zM5 15H4V4h11v1" className="text-slate-500" />Copy Number
          </button>
        </div>
      )}
      {note && <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-navy-900 px-4 py-2 text-sm text-white shadow-lg">{note}</div>}
    </>
  );
}

function Svg({ d, className }: { d: string; className: string }) {
  return <svg viewBox="0 0 24 24" className={`h-4 w-4 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { askHelp, type HelpAnswer } from "@/lib/actions/help";
import { FEATURES } from "@/lib/feature-guide";
import { Icon } from "./kit";
import { RichText, Inline } from "./guide-text";

type Msg = { role: "user" | "assistant"; text: string; ai?: boolean; matches?: HelpAnswer["matches"]; error?: string };

const STARTERS = [
  "Naya lead kaise add karu?",
  "WhatsApp number kaise connect kare?",
  "Leads automatically team me kaise baante?",
  "How do I send a broadcast to all hot leads?",
  "Quotation bana ke WhatsApp pe kaise bheju?",
  "Chatbot kaise banaye?",
];

const KEY = "lb_help_chat";

/** "Ask AI" help bot. Answers come from the feature guide; without AI it shows the best-matching guides. */
export function HelpBot({ onNavigate, tall = false }: { onNavigate?: () => void; tall?: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  // Keep the chat while moving between pages (this browser tab only).
  useEffect(() => {
    try { const s = sessionStorage.getItem(KEY); if (s) setMsgs(JSON.parse(s)); } catch {}
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-20))); } catch {}
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs, pending]);

  const ask = (text: string) => {
    const question = text.trim();
    if (!question || pending) return;
    const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setQ("");
    start(async () => {
      try {
        const r = await askHelp(question, history);
        setMsgs((m) => [...m, r.text
          ? { role: "assistant", text: r.text, ai: true, matches: r.matches }
          : { role: "assistant", text: "", ai: false, matches: r.matches, error: r.error }]);
      } catch {
        setMsgs((m) => [...m, { role: "assistant", text: "", error: "Could not reach the server. Check your internet and try again." }]);
      }
    });
  };

  return (
    <div className={`flex min-h-0 flex-col ${tall ? "h-full" : "max-h-[34rem]"}`}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {msgs.length === 0 && (
          <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-navy-900"><Icon name="sparkle" className="h-4 w-4 text-violet-600" /> Ask anything about Lead Box CRM</div>
            <p className="mt-1 text-xs text-slate-600">Hindi, Hinglish ya English me poochho. I&apos;ll guide you step by step and link the right page.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-full border border-violet-200 bg-white px-3 py-1.5 text-left text-xs font-medium text-violet-800 hover:bg-violet-100">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => m.role === "user" ? (
          <div key={i} className="flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-600 px-3 py-2 text-sm text-white">{m.text}</div></div>
        ) : (
          <div key={i} className="flex gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-brand-600 text-white"><Icon name="bot" className="h-4 w-4" /></span>
            <div className="min-w-0 max-w-[90%] rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              {m.text ? <RichText text={m.text} onNavigate={onNavigate} /> : <Fallback m={m} onNavigate={onNavigate} />}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-violet-100 text-violet-600"><Icon name="bot" className="h-4 w-4" /></span>
            <span className="animate-pulse">Soch raha hoon…</span>
          </div>
        )}
        <div ref={end} />
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input className="input flex-1" value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder="e.g. Follow-up reminder kaise lagaye?" aria-label="Your question" />
        <button className="btn-primary shrink-0" disabled={pending || !q.trim()} aria-label="Ask"><Icon name="send" className="h-4 w-4" /></button>
      </form>
      {msgs.length > 0 && (
        <button className="mt-2 self-start text-xs text-slate-500 hover:underline" onClick={() => { setMsgs([]); }}>New chat</button>
      )}
    </div>
  );
}

/** No AI answer (AI off, limit reached or error): show the matching guides' steps directly. */
function Fallback({ m, onNavigate }: { m: Msg; onNavigate?: () => void }) {
  const found = (m.matches ?? []).map((x) => FEATURES.find((f) => f.id === x.id)).filter((f) => f !== undefined);
  if (!found.length) {
    return <p>{m.error ? `${m.error} ` : ""}Iska guide nahi mila. Try other words (e.g. &quot;lead import&quot;, &quot;template&quot;, &quot;allocation&quot;) or browse <Link href="/guide" onClick={onNavigate} className="font-semibold text-brand-700 hover:underline">Features &amp; Guide</Link>.</p>;
  }
  const [top, ...rest] = found;
  return (
    <div className="space-y-2">
      <p className="font-semibold text-navy-900">{top.title}</p>
      <p className="text-xs text-slate-500">{top.what}</p>
      <ol className="list-decimal space-y-1 pl-5">{top.steps.map((s, i) => <li key={i}><Inline text={s} onNavigate={onNavigate} /></li>)}</ol>
      <Link href={top.href} onClick={onNavigate} className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">Open page <Icon name="chevronRight" className="h-3.5 w-3.5" /></Link>
      {rest.length > 0 && (
        <p className="border-t border-slate-100 pt-2 text-xs text-slate-500">Also see: {rest.map((f, i) => <span key={f.id}>{i > 0 && " · "}<Link href={`/guide#${f.id}`} onClick={onNavigate} className="font-medium text-brand-700 hover:underline">{f.title}</Link></span>)}</p>
      )}
    </div>
  );
}

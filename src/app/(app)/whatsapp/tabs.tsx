"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./ui";

export const WA_TABS = [
  { href: "/whatsapp", label: "Overview", icon: "overview", on: "bg-brand-600 text-white", off: "bg-brand-50 text-brand-700 border-brand-100",
    title: "WhatsApp Business", sub: "Numbers, messages, credits and everything WhatsApp in one place" },
  { href: "/whatsapp/connections", label: "Connections", icon: "plug", on: "bg-teal-700 text-white", off: "bg-teal-50 text-teal-800 border-teal-100",
    title: "Connections", sub: "Connect WhatsApp Business numbers (Cloud API) and check their health" },
  { href: "/whatsapp/contacts", label: "Contacts", icon: "contacts", on: "bg-pink-600 text-white", off: "bg-pink-50 text-pink-700 border-pink-100",
    title: "Contacts", sub: "Everyone you can message: single add, CSV import, tags and opt-in" },
  { href: "/whatsapp/templates", label: "Templates", icon: "template", on: "bg-violet-600 text-white", off: "bg-violet-50 text-violet-700 border-violet-100",
    title: "Templates", sub: "Meta-approved message templates, needed outside the 24-hour window" },
  { href: "/whatsapp/send", label: "Send", icon: "send", on: "bg-emerald-600 text-white", off: "bg-emerald-50 text-emerald-700 border-emerald-100",
    title: "Send a message", sub: "One-off send to any number: template, or free text inside the 24-hour window" },
  { href: "/whatsapp/campaigns", label: "Campaigns", icon: "megaphone", on: "bg-amber-500 text-white", off: "bg-amber-50 text-amber-800 border-amber-100",
    title: "Campaigns", sub: "Bulk template sends to a segment, with approval, consent and frequency checks" },
  { href: "/whatsapp/live-chat", label: "Live Chat", icon: "chat", on: "bg-blue-600 text-white", off: "bg-blue-50 text-blue-700 border-blue-100",
    title: "Live chat", sub: "Open conversations, unread messages and who is handling them" },
  { href: "/whatsapp/chatbots", label: "Chatbots", icon: "bot", on: "bg-purple-600 text-white", off: "bg-purple-50 text-purple-700 border-purple-100",
    title: "Chatbots", sub: "Keyword auto-replies, opt-out handling, away messages and the questions nobody answered" },
  { href: "/whatsapp/flows", label: "Flows", icon: "flow", on: "bg-indigo-600 text-white", off: "bg-indigo-50 text-indigo-700 border-indigo-100",
    title: "Flows", sub: "Multi-step automated journeys: welcome, follow-up, recovery and re-engagement" },
  { href: "/whatsapp/commerce", label: "Commerce", icon: "cart", on: "bg-orange-600 text-white", off: "bg-orange-50 text-orange-700 border-orange-100",
    title: "Commerce", sub: "Products and services you sell, and the leads and revenue they bring" },
  { href: "/whatsapp/reports", label: "Reports", icon: "chart", on: "bg-sky-600 text-white", off: "bg-sky-50 text-sky-700 border-sky-100",
    title: "Reports", sub: "Volume, delivery funnel, busiest hours, errors, credits, numbers, agents, bots and templates" },
  { href: "/whatsapp/settings", label: "Settings", icon: "gear", on: "bg-slate-700 text-white", off: "bg-slate-100 text-slate-700 border-slate-200",
    title: "Settings", sub: "Team preferences, agents, tags, canned replies, API and diagnostics" },
] as const;

export function WaHeader({ admin }: { admin: boolean }) {
  const path = usePathname();
  const active = [...WA_TABS].reverse().find((t) => path === t.href || (t.href !== "/whatsapp" && path.startsWith(t.href + "/"))) ?? WA_TABS[0];
  return (
    <div className="mb-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-brand-600 text-white shadow-sm">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2m0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2m4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 0 0 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.5-.3" /></svg>
          </span>
          <div>
            <h1 className="text-xl font-semibold text-navy-900">{active.title}</h1>
            <p className="text-sm text-slate-500">{active.sub}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/inbox" className="btn-ghost"><Icon name="chat" /> Open live chat</Link>
          {admin && <Link href="/whatsapp/connections" className="btn-primary"><Icon name="plus" /> Connect a number</Link>}
        </div>
      </div>
      <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-3" aria-label="WhatsApp sections">
        {WA_TABS.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t === active ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${t === active ? `${t.on} border-transparent shadow` : `${t.off} hover:brightness-95`}`}>
            <Icon name={t.icon} className="h-3.5 w-3.5" />{t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Secondary pill tabs driven by ?tab= */
export function SubTabs({ tabs, current, base }: { tabs: { key: string; label: string; icon: string; count?: number }[]; current: string; base: string }) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 pb-2 text-sm">
      {tabs.map((t) => (
        <Link key={t.key} href={`${base}?tab=${t.key}`}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 ${t.key === current ? "border border-brand-100 bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}>
          <Icon name={t.icon} className="h-3.5 w-3.5" />{t.label}{t.count !== undefined && <span className="rounded-full bg-white px-1.5 text-[10px] text-slate-600">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

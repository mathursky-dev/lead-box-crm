"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissBrief } from "@/lib/actions/auth";

export type Brief = {
  high_priority: number; overdue: number; due_today: number; stale: number; pipeline: number; open_leads: number; unread_chats: number;
  scope: "mine" | "team"; closed_statuses: string[];
  top: { id: string; lead_no: number; customer_name: string | null; phone_e164: string; reason: string; priority: string }[];
};

const inr = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

export function DayBrief({ name, brief, dateLabel, greeting }: { name: string; brief: Brief; dateLabel: string; greeting: string }) {
  const [open, setOpen] = useState(true);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!open) return null;
  const close = (to?: string) => start(async () => { await dismissBrief(); setOpen(false); if (to) router.push(to); });
  const whose = brief.scope === "mine" ? "your" : "your team's";
  const stats: { n: React.ReactNode; title: string; sub: string; href: string }[] = [
    { n: brief.high_priority, title: "High-priority leads", sub: `Open leads marked High or Urgent`, href: "/leads?open=1&priority=high,urgent" },
    { n: brief.overdue, title: "Overdue follow-ups", sub: `${brief.overdue} lead${brief.overdue === 1 ? "" : "s"} past due`, href: "/followups?tab=overdue" },
    { n: brief.due_today, title: "Due today", sub: `${brief.due_today} lead${brief.due_today === 1 ? "" : "s"} still to do today`, href: "/followups?tab=today" },
    { n: brief.stale.toLocaleString("en-IN"), title: "Worth reactivating", sub: "Open leads untouched for 14+ days", href: "/leads?open=1&stale=1" },
    { n: inr(brief.pipeline), title: "Open pipeline", sub: `Expected value of ${whose} ${brief.open_leads} open lead${brief.open_leads === 1 ? "" : "s"}`, href: "/leads?open=1" },
  ];
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-navy-950/50 p-0 sm:items-center sm:p-6" role="dialog" aria-modal aria-label="Your day">
      <div className="max-h-[94vh] w-full max-w-5xl overflow-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="px-6 pt-6 sm:px-10 sm:pt-9">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">
                <span className="h-0.5 w-8 bg-brand-600" />{dateLabel}
              </div>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-navy-900 sm:text-5xl">{greeting}, {name.split(" ")[0]}</h2>
              <p className="mt-2 text-lg text-slate-500">Here&apos;s where {whose} day stands.</p>
            </div>
            <div className="flex gap-2">
              <button className="rounded-xl border border-slate-200 p-3 text-slate-600 hover:bg-slate-50" aria-label="Refresh" title="Refresh" onClick={() => router.refresh()}>↻</button>
              <button className="rounded-xl border border-slate-200 p-3 text-slate-600 hover:bg-slate-50" aria-label="Close" onClick={() => close()} disabled={pending}>✕</button>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 border-y border-slate-200 sm:grid-cols-3 lg:grid-cols-5">
            {stats.map((s, i) => (
              <Link key={s.title} href={s.href} onClick={(e) => { e.preventDefault(); close(s.href); }}
                className={`block px-4 py-6 hover:bg-slate-50 ${i ? "lg:border-l" : ""} border-slate-200 max-lg:border-b`}>
                <div className="text-4xl font-bold tracking-tight text-navy-900 sm:text-5xl">{s.n}</div>
                <div className="mt-3 font-semibold text-navy-900">{s.title}</div>
                <div className="mt-1 text-sm text-slate-500">{s.sub}</div>
              </Link>
            ))}
          </div>

          <div className="py-7">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Start with these</div>
            {brief.top.length === 0 ? (
              <p className="mt-3 text-lg text-slate-600">Nothing urgent on {whose} leads right now.</p>
            ) : (
              <ul className="mt-3 divide-y rounded-xl border border-slate-200">
                {brief.top.map((l) => (
                  <li key={l.id}>
                    <a href={`/leads/${l.id}`} onClick={(e) => { e.preventDefault(); close(`/leads/${l.id}`); }} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                      <span><span className="font-medium text-navy-900">{l.customer_name || l.phone_e164}</span> <span className="text-sm text-slate-500">LB-{l.lead_no}</span></span>
                      <span className={`badge ${l.reason.startsWith("Overdue") ? "bg-red-50 text-red-700" : l.reason.includes("today") ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{l.reason}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {brief.unread_chats > 0 && (
              <p className="mt-3 text-sm text-slate-600">
                Also: <a href="/inbox" onClick={(e) => { e.preventDefault(); close("/inbox"); }} className="font-medium text-brand-700 hover:underline">{brief.unread_chats} WhatsApp chat{brief.unread_chats === 1 ? "" : "s"} with unread messages</a>
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-5 sm:px-10">
          <p className="text-sm text-slate-500">{brief.closed_statuses.length ? `Closed statuses left out: ${brief.closed_statuses.join(", ")}.` : ""}</p>
          <button className="rounded-xl bg-brand-600 px-7 py-3.5 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-50" disabled={pending} onClick={() => close()}>
            Start my day
          </button>
        </div>
      </div>
    </div>
  );
}

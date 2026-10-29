"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissBrief } from "@/lib/actions/auth";

type TeamBrief = {
  new_yesterday: number; updated_yesterday: number; converted_yesterday: number;
  overdue: number; unassigned: number; high_priority: number; stale: number; open_leads: number; pipeline: number;
};

// From lb_day_brief(): top numbers are the caller's own leads and follow-ups;
// `team` is the whole company (as RLS allows) and only set for admins/team leaders.
export type Brief = {
  high_priority: number; overdue: number; overdue_leads: number; due_today: number; due_today_leads: number;
  stale: number; pipeline: number; open_leads: number; unread_chats: number;
  closed_statuses: string[]; team: TeamBrief | null;
  top: { id: string; lead_no: number; customer_name: string | null; phone_e164: string; reason: string; priority: string }[];
};

const plural = (n: number | undefined, one: string) => `${(n ?? 0).toLocaleString("en-IN")} ${one}${n === 1 ? "" : "s"}`;

const inr = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

export function DayBrief({ userId, name, brief, dateLabel, greeting }: { userId: string; name: string; brief: Brief; dateLabel: string; greeting: string }) {
  const [open, setOpen] = useState(true);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!open) return null;
  const close = (to?: string) => start(async () => { await dismissBrief(); setOpen(false); if (to) router.push(to); });
  const team = brief.team;
  const mine = `/leads?open=1&owner_id=${userId}`;
  const stats: { n: React.ReactNode; title: string; sub: string; href: string; alert?: boolean }[] = [
    { n: brief.high_priority, title: "High-priority leads", sub: "Your open leads marked High or Urgent", href: `${mine}&priority=high,urgent` },
    { n: brief.overdue, title: "Overdue follow-ups", sub: `${plural(brief.overdue, "follow-up")} on ${plural(brief.overdue_leads, "lead")} past due`, href: "/followups?tab=overdue", alert: brief.overdue > 0 },
    { n: brief.due_today, title: "Due today", sub: `${plural(brief.due_today, "follow-up")} on ${plural(brief.due_today_leads, "lead")} still to do today`, href: "/followups?tab=today" },
    { n: brief.stale.toLocaleString("en-IN"), title: "Worth reactivating", sub: "Your open leads untouched for 14+ days", href: `${mine}&stale=1` },
    { n: inr(brief.pipeline), title: "Open pipeline", sub: `Expected value of your ${plural(brief.open_leads, "open lead")}`, href: mine },
  ];
  const go = (to: string) => (e: React.MouseEvent) => { e.preventDefault(); close(to); };
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
              <p className="mt-2 text-lg text-slate-500">Here&apos;s where your day stands.</p>
            </div>
            <div className="flex gap-2">
              <button className="rounded-xl border border-slate-200 p-3 text-slate-600 hover:bg-slate-50" aria-label="Refresh" title="Refresh" onClick={() => router.refresh()}>↻</button>
              <button className="rounded-xl border border-slate-200 p-3 text-slate-600 hover:bg-slate-50" aria-label="Close" onClick={() => close()} disabled={pending}>✕</button>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 border-y border-slate-200 sm:grid-cols-3 lg:grid-cols-5">
            {stats.map((s, i) => (
              <Link key={s.title} href={s.href} onClick={go(s.href)}
                className={`block px-4 py-6 hover:bg-slate-50 ${i ? "lg:border-l" : ""} border-slate-200 max-lg:border-b`}>
                <div className={`text-4xl font-bold tracking-tight sm:text-5xl ${s.alert ? "text-red-600" : "text-navy-900"}`}>{s.n}</div>
                <div className="mt-3 font-semibold text-navy-900">{s.title}</div>
                <div className="mt-1 text-sm text-slate-500">{s.sub}</div>
              </Link>
            ))}
          </div>

          <div className={team ? "grid gap-x-8 lg:grid-cols-[1fr_300px]" : ""}>
          <div className="py-7">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Start with these</div>
            {brief.top.length === 0 ? (
              <p className="mt-3 text-lg text-slate-600">Nothing urgent on your leads right now.</p>
            ) : (
              <ul className="mt-3 divide-y rounded-xl border border-slate-200">
                {brief.top.map((l) => (
                  <li key={l.id}>
                    <a href={`/leads/${l.id}`} onClick={go(`/leads/${l.id}`)} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                      <span><span className="font-medium text-navy-900">{l.customer_name || l.phone_e164}</span> <span className="text-sm text-slate-500">LB-{l.lead_no}</span></span>
                      <span className={`badge ${l.reason.startsWith("Overdue") ? "bg-red-50 text-red-700" : l.reason.includes("today") ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{l.reason}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {brief.unread_chats > 0 && (
              <p className="mt-3 text-sm text-slate-600">
                Also: <a href="/inbox" onClick={go("/inbox")} className="font-medium text-brand-700 hover:underline">{plural(brief.unread_chats, "WhatsApp chat")} with unread messages</a>
              </p>
            )}
          </div>
          {team && (
            <div className="border-slate-200 py-7 max-lg:border-t lg:border-l lg:pl-8">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Across your team</div>
              <p className="mt-1 text-sm text-slate-500">Every lead you can see in your account</p>
              <div className="mt-4 text-sm font-semibold text-navy-900">Yesterday</div>
              <div className="mt-2 grid grid-cols-3 divide-x divide-slate-200">
                {([["New leads", team.new_yesterday], ["Leads updated", team.updated_yesterday], ["Converted", team.converted_yesterday]] as const).map(([label, n], i) => (
                  <div key={label} className={i ? "pl-3" : "pr-3"}>
                    <div className="text-2xl font-bold text-navy-900">{n.toLocaleString("en-IN")}</div>
                    <div className="text-xs text-slate-500">{label}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 text-sm font-semibold text-navy-900">Needs attention</div>
              <ul className="mt-1 divide-y divide-slate-200 text-sm">
                {([
                  ["Follow-ups past due", team.overdue, "/followups?tab=overdue"],
                  ["Open leads with no owner", team.unassigned, "/leads?open=1&unassigned=1"],
                  ["High-priority leads", team.high_priority, "/leads?open=1&priority=high,urgent"],
                  ["Untouched for 14+ days", team.stale, "/leads?open=1&stale=1"],
                ] as const).map(([label, n, href]) => (
                  <li key={label}>
                    <a href={href} onClick={go(href)} className="flex justify-between py-2.5 text-slate-700 hover:text-navy-900">
                      <span>{label}</span><span className="font-semibold text-navy-900">{n.toLocaleString("en-IN")}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-500">{plural(team.open_leads, "open lead")} worth {inr(team.pipeline)}</p>
            </div>
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

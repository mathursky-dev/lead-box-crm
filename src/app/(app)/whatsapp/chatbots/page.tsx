import Link from "next/link";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/dates";
import { DEFAULT_PREFS, type WaBot } from "@/lib/wa";
import { Kpi, Panel, EmptyState, Icon } from "../ui";
import { SubTabs } from "../tabs";
import { agoIso } from "../data";
import { BotForm, BotRowActions, TestMessage } from "./bots";

export const metadata = { title: "Chatbots · WhatsApp" };
const KIND: Record<string, string> = { reply: "bg-brand-100 text-brand-700", unmatched: "bg-amber-50 text-amber-800", optout: "bg-red-50 text-red-700", optin: "bg-sky-50 text-sky-700", away: "bg-violet-50 text-violet-700" };

export default async function Chatbots({ searchParams }: { searchParams: Promise<{ tab?: string; f?: string; q?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab ?? "bots";
  const { profile } = await requireProfile();
  const admin = isAdmin(profile);
  const sb = await createClient();
  const since = agoIso(7 * 86400000);
  const [{ data: botRows }, { data: numbers }, { data: events }, { data: prefs }] = await Promise.all([
    sb.from("lb_wa_bots").select("*").order("priority"),
    sb.from("lb_wa_numbers").select("id,label").order("label"),
    sb.from("lb_wa_bot_events").select("id,kind,body,detail,bot_id,conversation_id,created_at").gte("created_at", tab === "logs" || tab === "unmatched" ? agoIso(30 * 86400000) : since).order("created_at", { ascending: false }).limit(500),
    sb.from("lb_wa_prefs").select("optout_enabled,hours_enabled,away_message,pause_bots_when_assigned").maybeSingle(),
  ]);
  const bots = (botRows ?? []) as WaBot[];
  const ev7 = (events ?? []).filter((e) => e.created_at >= since);
  const replies7 = ev7.filter((e) => e.kind === "reply").length;
  const unmatched7 = ev7.filter((e) => e.kind === "unmatched").length;
  const p = { ...DEFAULT_PREFS, ...(prefs ?? {}) };
  const botName = new Map(bots.map((b) => [b.id, b.name]));
  const shown = bots.filter((b) => (sp.f === "on" ? b.is_active : sp.f === "off" ? !b.is_active : true) &&
    (!sp.q || `${b.name} ${b.keywords.join(" ")}`.toLowerCase().includes(sp.q.toLowerCase())));

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Bots" value={bots.length} sub={`${bots.filter((b) => b.is_active).length} active`} icon="bot" tone="slate" />
        <Kpi label="Replies · 7 days" value={replies7} sub="automatic answers sent" icon="send" tone="green" />
        <Kpi label="Unmatched · 7 days" value={unmatched7} sub={<Link href="/whatsapp/chatbots?tab=unmatched" className="text-violet-700">messages no bot answered</Link>} icon="alert" tone="amber" />
        <Kpi label="Opt-out handling" value={<span className={`badge ${p.optout_enabled ? "bg-brand-100 text-brand-700" : "bg-slate-200"}`}>{p.optout_enabled ? "On" : "Off"}</span>}
          sub={<Link href="/whatsapp/settings" className="text-violet-700">STOP / START keywords · settings</Link>} icon="check" tone="violet" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TestMessage />
        {admin && <BotForm numbers={numbers ?? []} />}
      </div>
      <SubTabs base="/whatsapp/chatbots" current={tab} tabs={[
        { key: "bots", label: "Bots", icon: "bot", count: bots.length }, { key: "unmatched", label: "Unmatched questions", icon: "alert" },
        { key: "analytics", label: "Analytics", icon: "chart" }, { key: "logs", label: "Logs", icon: "clock" }]} />

      {tab === "bots" && (
        <Panel title="Keyword bots" icon="bot" actions={admin ? <BotForm numbers={numbers ?? []} library /> : null}>
          <form className="mb-3 flex flex-wrap items-center gap-2">
            <input name="q" defaultValue={sp.q} className="input max-w-xs" placeholder="Search bots and keywords…" />
            {[["", "All"], ["on", "Active"], ["off", "Off"]].map(([v, l]) => (
              <Link key={l} href={`/whatsapp/chatbots?f=${v}`} className={`rounded-full border px-3 py-1 text-xs ${(sp.f ?? "") === v ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300"}`}>{l}</Link>
            ))}
          </form>
          {!shown.length ? (
            <EmptyState icon="bot" title="No keyword bots yet" action={admin ? <BotForm numbers={numbers ?? []} library /> : null}>
              A keyword bot answers instantly when a message matches — e.g. “hi” → a welcome menu, “price” → your price list.
            </EmptyState>
          ) : (
            <div className="space-y-2">
              {shown.map((b) => (
                <div key={b.id} className={`rounded-lg border p-3 ${b.is_active ? "border-slate-200" : "border-dashed border-slate-300 opacity-70"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-slate-100 px-1.5 text-[11px] font-mono text-slate-600">#{b.priority}</span>
                        <span className="font-semibold text-navy-900">{b.name}</span>
                        <span className={`badge ${b.is_active ? "bg-brand-100 text-brand-700" : "bg-slate-200"}`}>{b.is_active ? "active" : "off"}</span>
                        <span className="text-xs text-slate-500">{b.match_type} · {b.hours_rule === "always" ? "any time" : `${b.hours_rule} hours`} · {b.reply_count} replies</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">{b.keywords.map((k) => <span key={k} className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700">{k}</span>)}</div>
                      <div className="mt-2 max-w-2xl whitespace-pre-wrap rounded-lg bg-[#e7f8ee] p-2 text-xs text-slate-800">{b.reply}</div>
                    </div>
                    {admin && <div className="flex gap-1"><BotForm numbers={numbers ?? []} bot={b} /><BotRowActions id={b.id} active={b.is_active} name={b.name} /></div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-4 flex items-start gap-1 text-xs text-slate-500"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5" />
            Order for every inbound text: <b>&nbsp;opt-out / opt-in keywords → keyword bots (lowest # first, first match wins) → away message</b>.
            {p.pause_bots_when_assigned ? " Bots stay quiet on chats already assigned to an agent." : ""}</p>
        </Panel>
      )}

      {tab === "unmatched" && (
        <Panel title="Unmatched questions · 30 days" icon="alert">
          {!(events ?? []).some((e) => e.kind === "unmatched") ? <EmptyState icon="check" title="Nothing unanswered">Messages no bot could answer show up here — turn the common ones into bots.</EmptyState> : (
            <ul className="divide-y text-sm">
              {(events ?? []).filter((e) => e.kind === "unmatched").slice(0, 100).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0 truncate">“{e.body}”</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">{fmtDateTime(e.created_at)}
                    {e.conversation_id && <Link href={`/inbox?c=${e.conversation_id}`} className="btn-ghost btn-sm">Reply</Link>}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === "analytics" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Top bots · 7 days" icon="chart">
            {!replies7 ? <p className="text-sm text-slate-500">No bot replies yet.</p> : (
              <ul className="space-y-2 text-sm">
                {Object.entries(ev7.filter((e) => e.kind === "reply").reduce<Record<string, number>>((a, e) => ({ ...a, [e.bot_id ?? "?"]: (a[e.bot_id ?? "?"] ?? 0) + 1 }), {}))
                  .sort((a, z) => z[1] - a[1]).map(([id, n]) => (
                    <li key={id}><div className="flex justify-between"><span>{botName.get(id) ?? "Deleted bot"}</span><b>{n}</b></div>
                      <div className="mt-1 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-purple-500" style={{ width: `${(n / replies7) * 100}%` }} /></div></li>
                  ))}
              </ul>
            )}
          </Panel>
          <Panel title="Automation mix · 7 days" icon="pulse">
            <ul className="space-y-2 text-sm">
              {[["Bot replies", "reply"], ["Unmatched", "unmatched"], ["Opt-outs", "optout"], ["Opt-ins", "optin"], ["Away messages", "away"]].map(([l, k]) => (
                <li key={k} className="flex justify-between"><span>{l}</span><b>{ev7.filter((e) => e.kind === k).length}</b></li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">Answer rate: {replies7 + unmatched7 ? Math.round((replies7 / (replies7 + unmatched7)) * 100) : 0}% of inbound questions handled by a bot.</p>
          </Panel>
        </div>
      )}

      {tab === "logs" && (
        <Panel title="Logs · 30 days" icon="clock">
          {!events?.length ? <p className="text-sm text-slate-500">No automation activity yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Event</th><th className="th">Message</th><th className="th">Bot / keyword</th><th className="th"></th></tr></thead>
              <tbody className="divide-y">{events.slice(0, 200).map((e) => (
                <tr key={e.id}>
                  <td className="td text-xs">{fmtDateTime(e.created_at)}</td>
                  <td className="td"><span className={`badge ${KIND[e.kind] ?? "bg-slate-100"}`}>{e.kind}</span></td>
                  <td className="td max-w-xs truncate">{e.body}</td>
                  <td className="td text-xs">{e.bot_id ? botName.get(e.bot_id) ?? "Deleted bot" : ""}{e.detail ? ` · “${e.detail}”` : ""}</td>
                  <td className="td">{e.conversation_id && <Link href={`/inbox?c=${e.conversation_id}`} className="text-xs text-brand-700 hover:underline">chat</Link>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Panel>
      )}
    </>
  );
}

import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtNum, pct } from "@/lib/wa";
import { Kpi, Panel, Bars, Legend, SERIES } from "../ui";
import { waReport, dayLabel } from "../data";

export const metadata = { title: "Reports · WhatsApp" };
const IST = 5.5 * 3600000;

function range(sp: { d?: string; from?: string; to?: string }) {
  if (sp.from && sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) {
    const from = new Date(new Date(sp.from + "T00:00:00Z").getTime() - IST);
    const to = new Date(new Date(sp.to + "T00:00:00Z").getTime() - IST + 86400000);
    if (to > from && to.getTime() - from.getTime() <= 366 * 86400000) return { from, to, key: "custom" };
  }
  const days = [7, 30, 90].includes(Number(sp.d)) ? Number(sp.d) : 30;
  const to = new Date();
  return { from: new Date(to.getTime() - days * 86400000), to, key: String(days) };
}

export default async function Reports({ searchParams }: { searchParams: Promise<{ d?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  await requireProfile();
  const { from, to, key } = range(sp);
  const sb = await createClient();
  const [r, { data: wallet }, { data: txns }] = await Promise.all([
    waReport(from, to),
    sb.from("lb_wallets").select("balance").maybeSingle(),
    sb.from("lb_wallet_txns").select("kind,amount,created_at").gte("created_at", from.toISOString()).lt("created_at", to.toISOString()).limit(5000),
  ]);
  const used = (txns ?? []).filter((t) => t.kind === "waba_usage").reduce((s, t) => s + Number(t.amount), 0);
  const topup = (txns ?? []).filter((t) => t.kind === "waba_topup").reduce((s, t) => s + Number(t.amount), 0);
  const maxH = Math.max(1, ...r.hours.map((h) => Math.max(h.in, h.out)));
  const iso = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
  const funnel: [string, number, string][] = [["Sent", r.sent, "bg-brand-500"], ["Delivered", r.delivered, "bg-sky-500"], ["Read", r.read, "bg-violet-500"], ["Failed", r.failed, "bg-red-500"]];

  return (
    <>
      <form className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="flex overflow-hidden rounded-md border border-slate-300">
          {["7", "30", "90"].map((d) => <Link key={d} href={`/whatsapp/reports?d=${d}`} className={`px-3 py-1.5 ${key === d ? "bg-navy-900 text-white" : "bg-white"}`}>{d} days</Link>)}
        </span>
        <input type="date" name="from" defaultValue={iso(from)} className="input w-auto" /> → <input type="date" name="to" defaultValue={iso(new Date(to.getTime() - 1))} className="input w-auto" />
        <button className="btn-ghost">Apply</button>
        <span className="text-xs text-slate-500">{iso(from)} → {iso(new Date(to.getTime() - 1))}</span>
      </form>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Sent" value={fmtNum(r.sent)} sub={`${r.failed} failed · ${r.queued} queued`} icon="send" tone="blue" />
        <Kpi label="Delivered" value={fmtNum(r.delivered)} sub={`${pct(r.delivered, r.sent)} of sent`} icon="check" tone="green" />
        <Kpi label="Read" value={fmtNum(r.read)} sub={`${pct(r.read, r.delivered)} of delivered`} icon="eye" tone="violet" />
        <Kpi label="Conversations" value={fmtNum(r.chats)} sub={`${fmtNum(r.received)} messages received`} icon="chat" tone="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Panel title="Messages per day" icon="chart" actions={<Legend items={[{ name: "Sent", color: SERIES.sent }, { name: "Received", color: SERIES.received }, { name: "Failed", color: SERIES.failed }]} />}>
            <Bars height={170} series={[{ name: "Sent", color: SERIES.sent }, { name: "Received", color: SERIES.received }, { name: "Failed", color: SERIES.failed }]}
              rows={r.daily.map((d) => ({ label: dayLabel(d.day), values: [d.sent, d.received, d.failed] }))} />
          </Panel>
          <Panel title="Busiest hours" icon="clock">
            <p className="mb-3 text-xs text-slate-500">When customers write (blue) and when you send (green), IST. Schedule campaigns for the peaks; staff the inbox for them.</p>
            <div className="grid gap-4 md:grid-cols-2">
              {(["in", "out"] as const).map((k) => (
                <div key={k}>
                  <div className="mb-1 text-xs font-semibold text-slate-600">{k === "in" ? "Received" : "Sent"}</div>
                  <div className="flex h-24 items-end gap-0.5">{r.hours.map((h) => (
                    <span key={h.h} title={`${h.h}:00 — ${h[k]}`} className="flex-1 rounded-t" style={{ height: `${Math.max(h[k] ? 5 : 2, (h[k] / maxH) * 100)}%`, background: h[k] ? (k === "in" ? SERIES.received : SERIES.sent) : "#e2e8f0" }} />
                  ))}</div>
                  <div className="flex justify-between text-[10px] text-slate-400"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="By number" icon="chat">
            <table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Number</th><th className="th">Sent</th><th className="th">Received</th><th className="th">Failed</th></tr></thead>
              <tbody className="divide-y">{r.by_number.length ? r.by_number.map((n) => (
                <tr key={n.label}><td className="td">{n.label} <span className="text-xs text-slate-500">{n.display_phone}</span></td><td className="td">{n.sent}</td><td className="td">{n.received}</td><td className="td text-red-600">{n.failed || ""}</td></tr>
              )) : <tr><td className="td text-slate-500" colSpan={4}>No activity.</td></tr>}</tbody></table>
          </Panel>
          <Panel title="Top templates" icon="template">
            <table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Template</th><th className="th">Sent</th><th className="th">Read</th><th className="th">Failed</th></tr></thead>
              <tbody className="divide-y">{r.templates.length ? r.templates.map((t) => (
                <tr key={t.name}><td className="td font-mono text-xs">{t.name}</td><td className="td">{t.sent}</td><td className="td">{t.read} <span className="text-xs text-slate-500">{pct(t.read, t.sent)}</span></td><td className="td text-red-600">{t.failed || ""}</td></tr>
              )) : <tr><td className="td text-slate-500" colSpan={4}>No template sends.</td></tr>}</tbody></table>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Delivery funnel" icon="sliders">
            <ul className="space-y-3 text-sm">{funnel.map(([l, v, c]) => (
              <li key={l}><div className="flex justify-between"><span>{l}</span><b>{fmtNum(v)}</b></div>
                <div className="mt-1 h-2 rounded bg-slate-100"><div className={`h-2 rounded ${c}`} style={{ width: `${r.sent ? Math.min(100, (v / r.sent) * 100) : 0}%` }} /></div></li>
            ))}</ul>
          </Panel>
          <Panel title="Why sends failed" icon="alert">
            {!r.errors.length ? <p className="py-3 text-center text-sm text-slate-500">✓ No failed sends in this range.</p> : (
              <ul className="space-y-2 text-sm">{r.errors.map((e, i) => <li key={i} className="flex justify-between gap-2"><span><span className="font-mono text-xs text-red-700">{e.code}</span> {e.message}</span><b>{e.n}</b></li>)}</ul>
            )}
          </Panel>
          <Panel title="Credits & categories" icon="wallet">
            <div className="mb-2 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded bg-slate-50 p-2"><div className="text-slate-500">Wallet</div><b>₹{fmtNum(wallet?.balance ?? 0)}</b></div>
              <div className="rounded bg-slate-50 p-2"><div className="text-slate-500">Topped up</div><b>₹{fmtNum(topup)}</b></div>
              <div className="rounded bg-slate-50 p-2"><div className="text-slate-500">Used</div><b>₹{fmtNum(used)}</b></div>
            </div>
            <table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Category</th><th className="th">Messages</th></tr></thead>
              <tbody className="divide-y">{r.categories.length ? r.categories.map((c) => <tr key={c.category}><td className="td capitalize">{c.category}</td><td className="td">{c.n}</td></tr>) : <tr><td className="td text-slate-500" colSpan={2}>No sends yet.</td></tr>}</tbody></table>
          </Panel>
          <Panel title="Agents" icon="agent">
            <table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Agent</th><th className="th">Replies</th><th className="th">Chats</th></tr></thead>
              <tbody className="divide-y">{r.agents.length ? r.agents.map((a) => <tr key={a.name}><td className="td">{a.name}</td><td className="td">{a.replies}</td><td className="td">{a.chats}</td></tr>) : <tr><td className="td text-slate-500" colSpan={3}>No agent replies.</td></tr>}</tbody></table>
          </Panel>
          <Panel title="Automation" icon="bot">
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between"><span>Keyword bot replies</span><b>{r.bots.replies}</b></li>
              <li className="flex justify-between"><span>Unmatched questions</span><b>{r.bots.unmatched}</b></li>
              <li className="flex justify-between"><span>Opt-outs by keyword</span><b>{r.bots.optouts}</b></li>
              <li className="flex justify-between"><span>Away messages</span><b>{r.bots.away}</b></li>
              <li className="flex justify-between"><span>Flow & campaign templates</span><b>{r.automated_templates}</b></li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

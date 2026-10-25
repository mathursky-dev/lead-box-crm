import Link from "next/link";
import { WA_GETTING_STARTED } from "@/components/guides";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/dates";
import { fmtNum } from "@/lib/wa";
import { Kpi, Panel, EmptyState, Notice, Bars, Legend, Icon, SERIES } from "./ui";
import { waReport, dayLabel } from "./data";

export default async function WaOverview() {
  const { profile } = await requireProfile();
  const sb = await createClient();
  const now = new Date();
  const [r, { data: numbers }, { data: wallet }, { count: templates }, { count: contacts }, { data: recent }, { count: openChats }, { count: unread }, { count: bots }] = await Promise.all([
    waReport(new Date(now.getTime() - 7 * 86400000), now),
    sb.from("lb_wa_numbers").select("id,label,display_phone,status,is_active,credit_balance,quality_rating"),
    sb.from("lb_wallets").select("balance").maybeSingle(),
    sb.from("lb_wa_templates").select("id", { count: "exact", head: true }).eq("status", "APPROVED"),
    sb.from("lb_customers").select("id", { count: "exact", head: true }),
    sb.from("lb_messages").select("id,direction,type,body,template_name,status,created_at,conversation:lb_conversations(id,customer:lb_customers(name,wa_profile_name,phone_e164))")
      .order("created_at", { ascending: false }).limit(8),
    sb.from("lb_conversations").select("id", { count: "exact", head: true }).neq("status", "resolved"),
    sb.from("lb_conversations").select("id", { count: "exact", head: true }).gt("unread_count", 0),
    sb.from("lb_wa_bots").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);
  const nums = numbers ?? [];
  const connected = nums.filter((n) => n.status === "connected" && n.is_active).length;
  const credits = nums.reduce((s, n) => s + Number(n.credit_balance ?? 0), 0);
  const admin = isAdmin(profile);

  const ok: Record<string, boolean> = {
    "/whatsapp/connections": connected > 0, "/whatsapp/templates": (templates ?? 0) > 0, "/whatsapp/contacts": (contacts ?? 0) > 0,
    "/whatsapp/send": r.sent > 0, "/whatsapp/chatbots": (bots ?? 0) > 0,
  };
  const steps: [string, string, boolean, string][] = WA_GETTING_STARTED.map(([t, s, href]) => [t, s, ok[href], href]);
  const done = steps.filter((s) => s[2]).length;

  const quick: [string, string, string, string][] = [
    ["Send a message", "Template or free text inside the 24-hour window.", "send", "/whatsapp/send"],
    ["New campaign", "Bulk template send to a segment.", "megaphone", "/whatsapp/campaigns"],
    ["Open live chat", "Answer customers with your team.", "chat", "/inbox"],
    ["Create template", "Submit a new template to Meta.", "template", "/whatsapp/templates"],
    ["Import contacts", "CSV import with tags.", "upload", "/import"],
    ["Build a chatbot", "Keyword auto-replies.", "bot", "/whatsapp/chatbots"],
    ["Design a flow", "Multi-step automated journeys.", "flow", "/whatsapp/flows"],
    ["Products", "What you sell, and what it earns.", "cart", "/whatsapp/commerce"],
    ["Reports", "Volume, funnel, agents and bots.", "chart", "/whatsapp/reports"],
    ["Connections", "Add or check a WhatsApp number.", "plug", "/whatsapp/connections"],
  ];

  return (
    <>
      {connected === 0 && (
        <Notice><b>No WhatsApp number connected yet.</b> Nothing can be sent or received until one is. Go to <Link className="font-semibold text-violet-700 underline" href="/whatsapp/connections">Connections</Link> and add your number.</Notice>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Connected numbers" value={connected} sub={<span className="text-violet-700">{nums.length} total · manage numbers</span>} icon="chat" tone="green" href="/whatsapp/connections" />
        <Kpi label="Sent · last 7 days" value={fmtNum(r.sent)} sub={r.failed ? <span className="text-red-600">{r.failed} failed</span> : "no failures"} icon="send" tone="blue" href="/whatsapp/reports" />
        <Kpi label="Received · last 7 days" value={fmtNum(r.received)} sub={`${openChats ?? 0} open chats · ${unread ?? 0} unread`} icon="inbox" tone="violet" href="/whatsapp/live-chat" />
        <Kpi label="Message credits" value={nums.length ? `₹${fmtNum(credits)}` : "—"} sub={wallet ? `Wallet ₹${fmtNum(wallet.balance)}` : "No wallet yet"} icon="wallet" tone="amber" />
      </div>

      <Panel title="Quick actions" icon="bolt" className="mt-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {quick.map(([t, s, i, h]) => (
            <Link key={t} href={h} className="group flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:border-brand-500 hover:bg-brand-50/40">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-slate-100 text-navy-800 group-hover:bg-white"><Icon name={i} /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-navy-900">{t}</span><span className="block truncate text-xs text-slate-500">{s}</span></span>
              <span className="text-slate-300">›</span>
            </Link>
          ))}
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Panel title="Messages · last 7 days" icon="chart" actions={<Legend items={[{ name: "Sent", color: SERIES.sent, value: r.sent }, { name: "Received", color: SERIES.received, value: r.received }]} />}>
            {r.sent + r.received === 0 ? (
              <EmptyState icon="chart" title="No messages in the last 7 days" action={<Link href="/whatsapp/send" className="btn-primary"><Icon name="send" /> Send your first message</Link>}>
                Once you send or receive a message, daily volume shows up here.
              </EmptyState>
            ) : <Bars height={160} series={[{ name: "Sent", color: SERIES.sent }, { name: "Received", color: SERIES.received }]} rows={r.daily.map((d) => ({ label: dayLabel(d.day), values: [d.sent, d.received] }))} />}
          </Panel>
          <Panel title="Recent activity" icon="clock" actions={<Link href="/inbox" className="btn-ghost btn-sm">Open live chat</Link>}>
            {!recent?.length ? <EmptyState icon="inbox" title="No messages yet">Sent and received messages will appear here.</EmptyState> : (
              <ul className="divide-y text-sm">
                {recent.map((m) => {
                  const c = m.conversation as unknown as { id: string; customer: { name: string | null; wa_profile_name: string | null; phone_e164: string } } | null;
                  const who = c?.customer.name ?? c?.customer.wa_profile_name ?? c?.customer.phone_e164 ?? "—";
                  return (
                    <li key={m.id}>
                      <Link href={c ? `/inbox?c=${c.id}` : "/inbox"} className="flex items-center gap-3 py-2 hover:bg-slate-50">
                        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${m.direction === "in" ? "bg-blue-50 text-blue-600" : "bg-brand-50 text-brand-600"}`}><Icon name={m.direction === "in" ? "inbox" : "send"} className="h-3.5 w-3.5" /></span>
                        <span className="min-w-0 flex-1"><span className="font-medium text-navy-900">{who}</span>
                          <span className="block truncate text-xs text-slate-500">{m.body ?? (m.template_name ? `Template: ${m.template_name}` : `[${m.type}]`)}</span></span>
                        <span className="shrink-0 text-right text-[11px] text-slate-400">{fmtDateTime(m.created_at)}<br />{m.direction === "out" && <span className={m.status === "failed" ? "text-red-600" : ""}>{m.status}</span>}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
        <Panel title="Getting started" icon="check" actions={<span className="badge bg-violet-50 text-violet-700">{done}/{steps.length}</span>}>
          <div className="mb-3 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
          <ol className="space-y-2">
            {steps.map(([t, s, ok, href], i) => (
              <li key={t}>
                <Link href={href} className="flex gap-3 rounded-lg border border-slate-200 p-3 hover:border-brand-500">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${ok ? "bg-brand-500 text-white" : "bg-navy-800 text-white"}`}>{ok ? <Icon name="check" className="h-3.5 w-3.5" /> : i + 1}</span>
                  <span><span className="block text-sm font-semibold text-navy-900">{t}</span><span className="text-xs text-slate-500">{s}</span></span>
                </Link>
              </li>
            ))}
          </ol>
          {!admin && <p className="mt-3 text-xs text-slate-500">Some steps need an admin.</p>}
        </Panel>
      </div>
    </>
  );
}

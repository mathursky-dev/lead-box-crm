import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/dates";
import { Kpi, Panel, EmptyState, Icon } from "../ui";
import { SubTabs } from "../tabs";
import { agoIso } from "../data";

export const metadata = { title: "Live chat · WhatsApp" };
const DOT: Record<string, string> = { available: "bg-brand-500", away: "bg-amber-500", offline: "bg-slate-400" };

export default async function LiveChat({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "open";
  await requireProfile();
  const sb = await createClient();
  const head = (f: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => f(base());
  function base() { return sb.from("lb_conversations").select("id", { count: "exact", head: true }); }
  const since = agoIso(24 * 3600000);
  const [open, unread, unassigned, pending, windowOpen, { data: agents }] = await Promise.all([
    head((q) => q.eq("status", "open")), head((q) => q.gt("unread_count", 0)), head((q) => q.neq("status", "resolved").is("assignee_id", null)),
    head((q) => q.eq("status", "pending")), head((q) => q.gte("last_inbound_at", since)),
    sb.from("lb_profiles").select("id,full_name,availability,role").eq("is_active", true).order("full_name"),
  ]);
  let q = sb.from("lb_conversations").select("id,status,unread_count,last_message_at,last_message_preview,last_inbound_at,assignee_id,customer:lb_customers(name,wa_profile_name,phone_e164),number:lb_wa_numbers(label)")
    .order("last_message_at", { ascending: false, nullsFirst: false }).limit(50);
  if (tab === "open") q = q.neq("status", "resolved");
  if (tab === "unread") q = q.gt("unread_count", 0);
  if (tab === "unassigned") q = q.neq("status", "resolved").is("assignee_id", null);
  if (tab === "resolved") q = q.eq("status", "resolved");
  const { data: convs } = await q;
  const name = new Map((agents ?? []).map((a) => [a.id, a.full_name]));
  const { data: load } = await sb.from("lb_conversations").select("assignee_id").neq("status", "resolved").not("assignee_id", "is", null).limit(5000);
  const openBy = new Map<string, number>();
  for (const r of load ?? []) openBy.set(r.assignee_id!, (openBy.get(r.assignee_id!) ?? 0) + 1);

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Open chats" value={open.count ?? 0} sub={`${pending.count ?? 0} pending`} icon="chat" tone="blue" />
        <Kpi label="Unread" value={unread.count ?? 0} sub="customers waiting for a reply" icon="inbox" tone="red" />
        <Kpi label="Unassigned" value={unassigned.count ?? 0} sub="nobody owns these yet" icon="agent" tone="amber" />
        <Kpi label="24h window open" value={windowOpen.count ?? 0} sub="free-text replies allowed" icon="clock" tone="green" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Panel title="Conversations" icon="chat" actions={<Link href="/inbox" className="btn-primary btn-sm"><Icon name="chat" className="h-3.5 w-3.5" /> Open live chat</Link>}>
          <SubTabs base="/whatsapp/live-chat" current={tab} tabs={[
            { key: "open", label: "Open", icon: "chat", count: open.count ?? 0 }, { key: "unread", label: "Unread", icon: "inbox", count: unread.count ?? 0 },
            { key: "unassigned", label: "Unassigned", icon: "agent", count: unassigned.count ?? 0 }, { key: "resolved", label: "Resolved", icon: "check" }]} />
          {!convs?.length ? <EmptyState icon="chat" title="Nothing here">New WhatsApp messages land here and in the Inbox.</EmptyState> : (
            <ul className="divide-y">
              {convs.map((c) => {
                const cu = c.customer as unknown as { name: string | null; wa_profile_name: string | null; phone_e164: string };
                const win = c.last_inbound_at && c.last_inbound_at > since;
                return (
                  <li key={c.id}>
                    <Link href={`/inbox?c=${c.id}`} className="flex items-center gap-3 py-2.5 hover:bg-slate-50">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{(cu.name ?? cu.wa_profile_name ?? "?").slice(0, 1).toUpperCase()}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2"><span className="truncate font-medium text-navy-900">{cu.name ?? cu.wa_profile_name ?? cu.phone_e164}</span>
                          {win && <span className="badge bg-brand-50 text-[10px] text-brand-700">24h open</span>}</span>
                        <span className="block truncate text-xs text-slate-500">{c.last_message_preview ?? "—"}</span>
                      </span>
                      <span className="shrink-0 text-right text-[11px] text-slate-500">
                        {fmtDateTime(c.last_message_at)}<br />
                        {(c.number as unknown as { label: string } | null)?.label} · {c.assignee_id ? name.get(c.assignee_id) ?? "agent" : <span className="text-amber-700">unassigned</span>}
                      </span>
                      {c.unread_count > 0 && <span className="rounded-full bg-brand-500 px-2 text-xs font-bold text-white">{c.unread_count}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Team" icon="agent">
          <ul className="space-y-2 text-sm">
            {(agents ?? []).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${DOT[a.availability ?? "offline"] ?? "bg-slate-400"}`} />{a.full_name}</span>
                <span className="text-xs text-slate-500">{openBy.get(a.id) ?? 0} open</span>
              </li>
            ))}
          </ul>
          <Link href="/whatsapp/settings?tab=agents" className="mt-3 block text-xs text-brand-700 hover:underline">Manage agents →</Link>
        </Panel>
      </div>
    </>
  );
}

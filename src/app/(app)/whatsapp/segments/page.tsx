import Link from "next/link";
import { requireProfile, can } from "@/lib/auth";
import { getSegmentMembers, getSegmentSummary } from "@/lib/actions/segments";
import { SMART, SMART_KEYS, inr, isSmartKey } from "@/lib/segments";
import { fmtDay } from "@/lib/dates";
import { Panel, EmptyState, Icon, Kpi, Notice, Table } from "../ui";
import { SegmentSettingsButton } from "./settings-form";

export const metadata = { title: "Customer segments · WhatsApp" };

export default async function SegmentsPage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const { profile } = await requireProfile();
  if (!can(profile, "campaigns.manage")) {
    return <Panel title="Customer segments" icon="layers"><EmptyState icon="layers" title="No access">Ask your admin for the “Create campaigns &amp; segments” permission.</EmptyState></Panel>;
  }
  const sp = await searchParams;
  const sum = await getSegmentSummary();
  if (sum.error || !sum.data) return <Notice tone="red">Could not load segments: {sum.error}</Notice>;
  const d = sum.data;
  const key = isSmartKey(sp.key) ? sp.key : null;
  const members = key ? await getSegmentMembers(key) : null;
  const byKey = new Map(d.segments.map((s) => [s.key, s]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-500">
          Customers are grouped automatically from won deals, paid invoices and store orders. Groups refresh every time you open this page or send a broadcast.
          Click <b>Broadcast</b> on a group to message it on WhatsApp.
        </p>
        <SegmentSettingsButton settings={d.settings} p90={d.p90_spend} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Customers" value={d.customers.toLocaleString("en-IN")} sub="with at least one lead" icon="contacts" tone="blue" />
        <Kpi label="Buyers" value={d.buyers.toLocaleString("en-IN")} sub="bought at least once" icon="cart" tone="green" />
        <Kpi label="Revenue counted" value={inr(d.revenue)} sub="orders + invoices + won deals" icon="rupee" tone="amber" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SMART_KEYS.map((k) => {
          const m = SMART[k]; const s = byKey.get(k);
          return (
            <div key={k} className={`card flex flex-col p-4 ${key === k ? "ring-2 ring-brand-500" : ""}`}>
              <div className="flex items-center gap-2">
                <span className={`grid h-9 w-9 place-items-center rounded-lg ${m.tone}`}><Icon name={m.icon} className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <div className="font-semibold text-navy-900">{m.label}</div>
                  <div className="text-xs text-slate-500">{m.rule(d.settings)}</div>
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-navy-900">{(s?.count ?? 0).toLocaleString("en-IN")}</span>
                <span className="text-xs text-slate-500">customers</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                <span className="badge bg-brand-100 text-brand-700" title="Opted in, not opted out, not suppressed">{s?.reachable ?? 0} on WhatsApp</span>
                {(s?.spent ?? 0) > 0 && <span className="badge bg-slate-100">{inr(s?.spent ?? 0)} spent</span>}
              </div>
              <div className="mt-2 text-[11px] text-slate-400">Idea: {m.idea}</div>
              <div className="mt-auto flex gap-2 pt-3">
                <Link className="btn-ghost btn-sm" href={`/whatsapp/segments?key=${k}#list`} scroll={false}><Icon name="eye" />See customers</Link>
                <Link className={`btn-sm ${s?.count ? "btn-primary" : "btn-ghost pointer-events-none opacity-50"}`} aria-disabled={!s?.count}
                  href={`/whatsapp/broadcast?smart=${k}`}><Icon name="send" />Broadcast</Link>
              </div>
            </div>
          );
        })}
      </div>

      {key && (
        <div id="list">
          <Panel title={`${SMART[key].label} · ${byKey.get(key)?.count ?? 0}`} icon={SMART[key].icon}
            actions={<Link className="btn-primary btn-sm" href={`/whatsapp/broadcast?smart=${key}`}><Icon name="send" />Broadcast to this group</Link>}>
            {members?.error ? <Notice tone="red">{members.error}</Notice> : (
              <Table head={["Customer", "Purchases", "Spent", "Last purchase", "Last message", "WhatsApp", "Lead"]}
                empty={members?.rows?.length ? undefined : "Nobody in this group right now."}>
                {(members?.rows ?? []).map((r) => (
                  <tr key={r.customer_id}>
                    <td className="td"><div className="font-medium text-navy-900">{r.name || "—"}</div><div className="text-xs text-slate-500">{r.phone_e164}</div></td>
                    <td className="td">{r.orders}</td>
                    <td className="td">{r.spent > 0 ? inr(r.spent) : "—"}</td>
                    <td className="td text-xs">{fmtDay(r.last_buy)}</td>
                    <td className="td text-xs">{fmtDay(r.last_inbound)}</td>
                    <td className="td">{r.opted_out ? <span className="badge bg-red-50 text-red-700">opted out</span> : r.opted_in ? <span className="badge bg-brand-100 text-brand-700">opted in</span> : <span className="badge bg-amber-50 text-amber-800">no opt-in</span>}</td>
                    <td className="td">{r.lead_id ? <Link className="text-brand-700 hover:underline" href={`/leads/${r.lead_id}`}>#{r.lead_no}</Link> : "—"}</td>
                  </tr>
                ))}
              </Table>
            )}
            {(members?.rows?.length ?? 0) >= 200 && <p className="mt-2 text-xs text-slate-500">Showing the top 200 by spend. A broadcast reaches the whole group.</p>}
          </Panel>
        </div>
      )}
    </div>
  );
}

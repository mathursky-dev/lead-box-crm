import Link from "next/link";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/dates";
import { Pager } from "@/components/static";
import { Panel, EmptyState, Icon } from "../ui";

export const metadata = { title: "Contacts · WhatsApp" };
const LIMIT = 50;

type SP = { q?: string; opt?: string; tag?: string; offset?: string };

export default async function Contacts({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const offset = Math.max(0, Number(sp.offset) || 0);
  const [{ data: tags }, { data: segments }] = await Promise.all([
    sb.from("lb_tags").select("id,name,color").order("name"),
    sb.from("lb_segments").select("id,name").order("name").limit(20),
  ]);

  let customerIds: string[] | null = null;
  if (sp.tag) {
    const { data } = await sb.from("lb_lead_tags").select("lead:lb_leads(customer_id)").eq("tag_id", sp.tag).limit(2000);
    customerIds = [...new Set((data ?? []).map((x) => (x.lead as unknown as { customer_id: string } | null)?.customer_id).filter(Boolean) as string[])];
  }
  let q = sb.from("lb_customers").select("id,name,wa_profile_name,phone_e164,email,wa_opt_in_at,wa_opted_out_at,created_at", { count: "exact" });
  if (sp.q) {
    const term = sp.q.replace(/[%,()]/g, " ").trim();
    if (term) q = q.or(`name.ilike.%${term}%,wa_profile_name.ilike.%${term}%,phone_e164.ilike.%${term}%,email.ilike.%${term}%`);
  }
  if (sp.opt === "in") q = q.is("wa_opted_out_at", null).not("wa_opt_in_at", "is", null);
  if (sp.opt === "out") q = q.not("wa_opted_out_at", "is", null);
  if (sp.opt === "unknown") q = q.is("wa_opted_out_at", null).is("wa_opt_in_at", null);
  if (customerIds) q = q.in("id", customerIds.length ? customerIds.slice(0, 1000) : ["00000000-0000-0000-0000-000000000000"]);
  const { data: rows, count } = await q.order("created_at", { ascending: false }).range(offset, offset + LIMIT - 1);

  const ids = (rows ?? []).map((r) => r.id);
  const [{ data: convs }, { data: leads }] = ids.length ? await Promise.all([
    sb.from("lb_conversations").select("id,customer_id,last_message_at").in("customer_id", ids),
    sb.from("lb_leads").select("id,customer_id,lead_tags:lb_lead_tags(tag:lb_tags(name,color))").in("customer_id", ids),
  ]) : [{ data: [] }, { data: [] }];
  const lastMsg = new Map<string, { id: string; at: string | null }>();
  for (const c of convs ?? []) {
    const cur = lastMsg.get(c.customer_id);
    if (!cur || (c.last_message_at ?? "") > (cur.at ?? "")) lastMsg.set(c.customer_id, { id: c.id, at: c.last_message_at });
  }
  const tagMap = new Map<string, { name: string; color: string }[]>();
  const leadOf = new Map<string, string>();
  for (const l of leads ?? []) {
    leadOf.set(l.customer_id, l.id);
    const t = (l.lead_tags as unknown as { tag: { name: string; color: string } | null }[]).map((x) => x.tag).filter(Boolean) as { name: string; color: string }[];
    tagMap.set(l.customer_id, [...(tagMap.get(l.customer_id) ?? []), ...t]);
  }
  const params = { q: sp.q, opt: sp.opt, tag: sp.tag };

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <div className="space-y-4">
        <Panel title="Groups" icon="contacts" actions={can(profile, "campaigns.manage") ? <Link href="/nurture/segments" className="btn-ghost btn-sm" title="New group (segment)">+</Link> : null}>
          <ul className="space-y-1 text-sm">
            <li><Link href="/whatsapp/contacts" className="flex justify-between rounded px-2 py-1 font-semibold hover:bg-slate-50">All contacts <span className="text-xs text-slate-500">{!sp.q && !sp.opt && !sp.tag ? count ?? 0 : ""}</span></Link></li>
            {(segments ?? []).map((s) => <li key={s.id}><Link href="/nurture/segments" className="block truncate rounded px-2 py-1 text-slate-600 hover:bg-slate-50">{s.name}</Link></li>)}
          </ul>
        </Panel>
        <Panel title="Filters" icon="sliders">
          <form className="space-y-3">
            {sp.q && <input type="hidden" name="q" value={sp.q} />}
            <label className="block"><span className="label">Tag</span>
              <select name="tag" defaultValue={sp.tag ?? ""} className="input"><option value="">Any tag</option>{(tags ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label className="block"><span className="label">Opt-in</span>
              <select name="opt" defaultValue={sp.opt ?? ""} className="input"><option value="">Any</option><option value="in">Opted in</option><option value="out">Opted out</option><option value="unknown">Not recorded</option></select></label>
            <button className="btn-navy w-full">Apply</button>
          </form>
        </Panel>
      </div>
      <Panel title={`${count ?? 0} contact(s)`} icon="contacts" actions={<>
        {can(profile, "leads.import") && <Link href="/import" className="btn-ghost btn-sm"><Icon name="upload" className="h-3.5 w-3.5" /> Import CSV</Link>}
        <a href={`/api/export/contacts?${new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][])}`} className="btn-ghost btn-sm"><Icon name="download" className="h-3.5 w-3.5" /> Export</a>
        {can(profile, "leads.create") && <Link href="/leads/new" className="btn-primary btn-sm"><Icon name="plus" className="h-3.5 w-3.5" /> Add contact</Link>}
      </>}>
        <form className="mb-3">
          {sp.opt && <input type="hidden" name="opt" value={sp.opt} />}{sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
          <input name="q" defaultValue={sp.q} className="input max-w-sm" placeholder="Search name, phone, email…" />
        </form>
        {!rows?.length ? <EmptyState icon="contacts" title="No contacts">Add one, import a CSV, or let inbound messages create them.</EmptyState> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-slate-50"><tr><th className="th">Contact</th><th className="th">Phone</th><th className="th">Tags</th><th className="th">Opt-in</th><th className="th">Last message</th><th className="th"></th></tr></thead>
                <tbody className="divide-y">
                  {rows.map((c) => {
                    const lm = lastMsg.get(c.id);
                    const lead = leadOf.get(c.id);
                    return (
                      <tr key={c.id}>
                        <td className="td"><Link href={`/customers/${c.id}`} className="font-medium text-navy-900 hover:text-brand-700">{c.name ?? c.wa_profile_name ?? "Unnamed"}</Link>{c.email && <div className="text-xs text-slate-500">{c.email}</div>}</td>
                        <td className="td font-mono text-xs">{c.phone_e164}</td>
                        <td className="td"><span className="flex flex-wrap gap-1">{(tagMap.get(c.id) ?? []).slice(0, 4).map((t, i) => <span key={i} className="badge text-white" style={{ background: t.color }}>{t.name}</span>)}</span></td>
                        <td className="td">{c.wa_opted_out_at ? <span className="badge bg-red-50 text-red-700">opted out</span> : c.wa_opt_in_at ? <span className="badge bg-brand-100 text-brand-700">opted in</span> : <span className="text-xs text-slate-400">—</span>}</td>
                        <td className="td text-xs">{lm ? <Link href={`/inbox?c=${lm.id}`} className="text-brand-700 hover:underline">{fmtDateTime(lm.at)}</Link> : "—"}</td>
                        <td className="td text-right"><Link href={`/whatsapp/send?phone=${encodeURIComponent(c.phone_e164)}`} className="btn-ghost btn-sm">Message</Link>{lead && <Link href={`/leads/${lead}`} className="ml-1 btn-ghost btn-sm">Lead</Link>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager total={count ?? 0} limit={LIMIT} offset={offset} params={params} basePath="/whatsapp/contacts" />
          </>
        )}
      </Panel>
    </div>
  );
}

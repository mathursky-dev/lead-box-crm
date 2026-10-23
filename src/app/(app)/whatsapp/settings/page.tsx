import Link from "next/link";
import { headers } from "next/headers";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/dates";
import { GRAPH_VERSION } from "@/lib/whatsapp";
import { DEFAULT_PREFS, type WaPrefs } from "@/lib/wa";
import { OrgList } from "../../admin/org-list";
import { QuickReplies } from "../../admin/catalog/quick-replies";
import { CopyField } from "../../admin/integrations/forms";
import { Panel, EmptyState, Icon } from "../ui";
import { SubTabs } from "../tabs";
import { agoIso } from "../data";
import { PrefsForm, AgentRow } from "./forms";

export const metadata = { title: "Settings · WhatsApp" };

export default async function Settings({ searchParams }: { searchParams: Promise<{ tab?: string; d?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab ?? "preferences";
  const { profile } = await requireProfile();
  const admin = isAdmin(profile);
  const sb = await createClient();
  const tabs = [
    { key: "preferences", label: "Preferences", icon: "sliders" }, { key: "agents", label: "Agents", icon: "agent" },
    { key: "tags", label: "Tags & auto-assign", icon: "tag" }, { key: "canned", label: "Canned replies", icon: "bolt" },
    { key: "api", label: "API", icon: "code" }, { key: "diagnostics", label: "Diagnostics", icon: "pulse" },
  ];
  return (
    <>
      <SubTabs base="/whatsapp/settings" current={tab} tabs={tabs} />
      {!admin && <p className="mb-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">Read only — only an admin can change WhatsApp settings.</p>}
      {tab === "preferences" && <Preferences admin={admin} sb={sb} companyId={profile.company_id} />}
      {tab === "agents" && <Agents admin={admin} sb={sb} />}
      {tab === "tags" && <Tags admin={admin} sb={sb} />}
      {tab === "canned" && <Canned admin={admin} sb={sb} />}
      {tab === "api" && <Api admin={admin} companyId={profile.company_id} />}
      {tab === "diagnostics" && <Diagnostics admin={admin} companyId={profile.company_id} d={sp.d} />}
    </>
  );
}

type Sb = Awaited<ReturnType<typeof createClient>>;

async function Preferences({ admin, sb, companyId }: { admin: boolean; sb: Sb; companyId: string }) {
  const [{ data }, { data: co }] = await Promise.all([
    sb.from("lb_wa_prefs").select("*").maybeSingle(),
    sb.from("lb_companies").select("default_country").eq("id", companyId).maybeSingle(),
  ]);
  const p: WaPrefs = { ...DEFAULT_PREFS, ...(data ?? {}) };
  p.hours_from = p.hours_from.slice(0, 5); p.hours_to = p.hours_to.slice(0, 5);
  return <Panel title="Team preferences" icon="sliders" className="max-w-4xl"><PrefsForm p={p} country={co?.default_country ?? "IN"} disabled={!admin} /></Panel>;
}

async function Agents({ admin, sb }: { admin: boolean; sb: Sb }) {
  const [{ data: users }, { data: load }] = await Promise.all([
    sb.from("lb_profiles").select("id,full_name,email,role,availability,accepts_auto_allocation,allocation_limit").eq("is_active", true).order("full_name"),
    sb.from("lb_conversations").select("assignee_id").neq("status", "resolved").not("assignee_id", "is", null).limit(5000),
  ]);
  const open = new Map<string, number>();
  for (const r of load ?? []) open.set(r.assignee_id!, (open.get(r.assignee_id!) ?? 0) + 1);
  return (
    <Panel title="Live chat agents" icon="agent" className="max-w-5xl" actions={admin ? <Link href="/admin/users" className="btn-ghost btn-sm">Add users</Link> : null}>
      <p className="mb-2 text-sm text-slate-500">Who can receive conversations. Auto-assign hands new WhatsApp leads to available agents with free capacity, using your <Link className="text-brand-700 hover:underline" href="/admin/allocation">allocation rules</Link> (round-robin).</p>
      {(users ?? []).map((u) => admin ? <AgentRow key={u.id} a={u} open={open.get(u.id) ?? 0} /> : (
        <div key={u.id} className="flex justify-between border-b py-2 text-sm"><span>{u.full_name}</span><span className="text-slate-500">{u.availability} · {open.get(u.id) ?? 0} open</span></div>
      ))}
    </Panel>
  );
}

async function Tags({ admin, sb }: { admin: boolean; sb: Sb }) {
  const [{ data: tags }, { data: rules }] = await Promise.all([
    sb.from("lb_tags").select("id,name,color").order("name"),
    sb.from("lb_allocation_rules").select("id,name,priority,is_active").order("priority"),
  ]);
  return (
    <div className="grid max-w-5xl gap-4 md:grid-cols-2">
      {admin ? <OrgList table="lb_tags" title="Tags" items={tags ?? []} color /> : (
        <Panel title="Tags" icon="tag"><div className="flex flex-wrap gap-1">{(tags ?? []).map((t) => <span key={t.id} className="badge text-white" style={{ background: t.color }}>{t.name}</span>)}</div></Panel>
      )}
      <Panel title="Auto-assign rules" icon="agent" actions={admin ? <Link href="/admin/allocation" className="btn-ghost btn-sm">Manage</Link> : null}>
        {!rules?.length ? <p className="text-sm text-slate-500">No rules yet — new chats go to the default round-robin pool.</p> : (
          <ul className="divide-y text-sm">{rules.map((r) => <li key={r.id} className="flex justify-between py-2"><span>#{r.priority} {r.name}</span><span className={r.is_active ? "text-brand-700" : "text-slate-400"}>{r.is_active ? "active" : "off"}</span></li>)}</ul>
        )}
        <p className="mt-3 text-xs text-slate-500">Rules match on WhatsApp number, branch, department, product or source and pick an agent round-robin.</p>
      </Panel>
    </div>
  );
}

async function Canned({ admin, sb }: { admin: boolean; sb: Sb }) {
  const { data } = await sb.from("lb_quick_replies").select("id,shortcut,title,body").order("shortcut");
  if (admin) return <div className="max-w-5xl"><QuickReplies items={data ?? []} /></div>;
  return (
    <Panel title="Canned replies" icon="bolt" className="max-w-5xl">
      <ul className="divide-y text-sm">{(data ?? []).map((q) => <li key={q.id} className="py-2"><span className="font-mono text-brand-700">/{q.shortcut}</span> {q.title}<div className="text-slate-600">{q.body}</div></li>)}</ul>
    </Panel>
  );
}

async function Api({ admin, companyId }: { admin: boolean; companyId: string }) {
  const h = await headers();
  const base = process.env.APP_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const integ = admin && hasServiceRole() ? (await createAdminClient().from("lb_integrations").select("meta_app_id,verify_token").eq("company_id", companyId).maybeSingle()).data : null;
  return (
    <div className="grid max-w-5xl gap-4 md:grid-cols-2">
      <Panel title="Meta webhook" icon="link">
        <div className="space-y-3">
          <CopyField label="Callback URL" value={`${base}/api/whatsapp/webhook`} />
          {integ?.verify_token && <CopyField label="Verify token" value={integ.verify_token} secret />}
          <div className="text-sm"><span className="label">Graph API version</span><span className="font-mono">{GRAPH_VERSION}</span></div>
          {integ?.meta_app_id && <div className="text-sm"><span className="label">Meta App ID</span><span className="font-mono">{integ.meta_app_id}</span></div>}
        </div>
        <p className="mt-3 text-xs text-slate-500">Subscribe the <b>messages</b> and <b>message_template_status_update</b> fields. Every delivery is signature-checked with the App Secret (<Link className="text-brand-700 hover:underline" href="/admin/integrations">Admin → Integrations</Link>).</p>
      </Panel>
      <Panel title="Other endpoints" icon="code">
        <div className="space-y-3">
          <CopyField label="Facebook lead ads webhook" value={`${base}/api/facebook/webhook`} />
          <CopyField label="Background jobs (cron, needs CRON_SECRET)" value={`${base}/api/jobs/run`} />
          <CopyField label="Contacts CSV export (signed-in users)" value={`${base}/api/export/contacts`} />
        </div>
        <p className="mt-3 text-xs text-slate-500">Access tokens stay encrypted on the server and are never shown here.</p>
      </Panel>
    </div>
  );
}

async function Diagnostics({ admin, companyId, d }: { admin: boolean; companyId: string; d?: string }) {
  if (!admin || !hasServiceRole()) return <EmptyState icon="pulse" title="Diagnostics are for admins">Ask an admin to check API calls, webhooks and number health.</EmptyState>;
  const db = createAdminClient();
  const since = agoIso(86400000);
  const stuck = agoIso(10 * 60000);
  const [{ data: nums }, { data: hooks }, { count: hookFail }, { data: fails }, { count: sent24 }, { count: failed24 }, { count: stuckN }] = await Promise.all([
    db.from("lb_wa_numbers").select("id,label,display_phone,status,is_active,quality_rating,last_error,last_checked_at,last_webhook_at").eq("company_id", companyId),
    db.from("lb_webhook_events").select("id,received_at,processed_at,attempts,error").gte("received_at", since).order("received_at", { ascending: false }).limit(50),
    db.from("lb_webhook_events").select("id", { count: "exact", head: true }).is("processed_at", null).not("error", "is", null),
    db.from("lb_messages").select("id,error_code,error_message,failed_at,conversation_id,template_name").eq("company_id", companyId).eq("status", "failed").order("failed_at", { ascending: false, nullsFirst: false }).limit(30),
    db.from("lb_messages").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("direction", "out").gte("created_at", since),
    db.from("lb_messages").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "failed").gte("created_at", since),
    db.from("lb_messages").select("id", { count: "exact", head: true }).eq("company_id", companyId).in("status", ["queued", "sending"]).lt("created_at", stuck),
  ]);
  const n = nums ?? [];
  const last = n.map((x) => x.last_webhook_at).filter(Boolean).sort().at(-1) ?? null;
  const active = n.filter((x) => x.is_active && x.status === "connected").length;
  const tiles: [string, string, boolean | null][] = [
    ["Sends · 24h", `${sent24 ?? 0} sent, ${failed24 ?? 0} failed`, !(failed24 ?? 0)],
    ["Webhooks · 24h", `${hooks?.length ?? 0} deliveries · last ${last ? fmtDateTime(last) : "never"}`, (hookFail ?? 0) === 0 && Boolean(last)],
    ["Stuck in queue", `${stuckN ?? 0} message(s) queued > 10 min`, !(stuckN ?? 0)],
    ["Numbers", `${active} active of ${n.length}`, n.length ? active === n.length : null],
  ];
  const view = d ?? "numbers";
  return (
    <Panel title="Diagnostics" icon="pulse" actions={<Link href={`/whatsapp/settings?tab=diagnostics&d=${view}`} className="btn-ghost btn-sm">Refresh</Link>}>
      <p className="mb-3 text-sm text-slate-500">What the module has been doing: sends, webhook deliveries and the health of each number. The first place to look when “nothing happened”.</p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(([t, s, ok]) => (
          <div key={t} className="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${ok === null ? "bg-amber-500" : ok ? "bg-brand-500" : "bg-red-500"}`} />
            <div><div className="text-sm font-semibold text-navy-900">{t}</div><div className="text-xs text-slate-500">{s}</div></div>
          </div>
        ))}
      </div>
      <nav className="mb-3 flex gap-1 text-sm">
        {[["sends", "Failed sends", "send"], ["webhooks", "Webhooks", "link"], ["numbers", "Numbers", "chat"]].map(([k, l, i]) => (
          <Link key={k} href={`/whatsapp/settings?tab=diagnostics&d=${k}`} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 ${view === k ? "border border-brand-100 bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-100"}`}><Icon name={i} className="h-3.5 w-3.5" />{l}</Link>
        ))}
      </nav>
      {view === "numbers" && (!n.length ? <EmptyState icon="plug" title="No numbers connected." /> : (
        <ul className="divide-y text-sm">{n.map((x) => (
          <li key={x.id} className="py-2"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{x.label} <span className="text-xs text-slate-500">{x.display_phone}</span></span>
            <span className="text-xs">{x.status}{x.quality_rating ? ` · quality ${x.quality_rating}` : ""} · checked {fmtDateTime(x.last_checked_at)} · webhook {fmtDateTime(x.last_webhook_at)}</span></div>
            {x.last_error && <div className="text-xs text-red-700">{x.last_error}</div>}</li>
        ))}</ul>
      ))}
      {view === "webhooks" && (!hooks?.length ? <p className="text-sm text-slate-500">No webhook deliveries in the last 24 hours. If customers are writing, check the callback URL and the subscription in Meta.</p> : (
        <table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">Received</th><th className="th">Processed</th><th className="th">Attempts</th><th className="th">Error</th></tr></thead>
          <tbody className="divide-y">{hooks.map((h) => <tr key={h.id}><td className="td text-xs">{fmtDateTime(h.received_at)}</td><td className="td text-xs">{h.processed_at ? fmtDateTime(h.processed_at) : <span className="text-amber-700">pending</span>}</td><td className="td">{h.attempts}</td><td className="td text-xs text-red-700">{h.error}</td></tr>)}</tbody></table>
      ))}
      {view === "sends" && (!fails?.length ? <p className="text-sm text-slate-500">No failed sends. 🎉</p> : (
        <table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Code</th><th className="th">Error</th><th className="th"></th></tr></thead>
          <tbody className="divide-y">{fails.map((f) => <tr key={f.id}><td className="td text-xs">{fmtDateTime(f.failed_at)}</td><td className="td font-mono text-xs">{f.error_code}</td><td className="td text-xs">{f.template_name ? <b>{f.template_name}: </b> : null}{f.error_message}</td><td className="td"><Link href={`/inbox?c=${f.conversation_id}`} className="text-xs text-brand-700 hover:underline">chat</Link></td></tr>)}</tbody></table>
      ))}
    </Panel>
  );
}

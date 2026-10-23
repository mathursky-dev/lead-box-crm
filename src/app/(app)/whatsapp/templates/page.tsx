import Link from "next/link";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/dates";
import { TemplateForm, SyncButton } from "../../admin/templates/template-form";
import { Kpi, Panel, EmptyState } from "../ui";

export const metadata = { title: "Templates · WhatsApp" };
const STATUS: Record<string, string> = { APPROVED: "bg-brand-100 text-brand-700", REJECTED: "bg-red-100 text-red-700", PENDING: "bg-amber-50 text-amber-800", PAUSED: "bg-slate-200 text-slate-700" };

export default async function Templates({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const [{ data: all }, { data: numbers }] = await Promise.all([
    sb.from("lb_wa_templates").select("*").neq("status", "DELETED").order("name"),
    sb.from("lb_wa_numbers").select("id,label").eq("is_active", true).order("label"),
  ]);
  const list = (all ?? []).filter((t) => (!sp.status || t.status === sp.status) && (!sp.q || t.name.includes(sp.q.toLowerCase())));
  const by = (s: string) => (all ?? []).filter((t) => t.status === s).length;
  const admin = isAdmin(profile);
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Approved" value={by("APPROVED")} sub="ready to send" icon="check" tone="green" />
        <Kpi label="Pending review" value={by("PENDING")} sub="waiting on Meta" icon="clock" tone="amber" />
        <Kpi label="Rejected" value={by("REJECTED")} sub="edit and resubmit" icon="alert" tone="red" />
        <Kpi label="Marketing" value={(all ?? []).filter((t) => t.category === "MARKETING").length} sub="blocked for opted-out contacts" icon="megaphone" tone="violet" />
      </div>
      <Panel title="Message templates" icon="template" actions={admin && numbers?.length ? <>{numbers.map((n) => <SyncButton key={n.id} id={n.id} label={n.label} />)}<TemplateForm numbers={numbers} /></> : null}>
        <form className="mb-3 flex flex-wrap gap-2">
          <input name="q" defaultValue={sp.q} placeholder="Search template name…" className="input max-w-xs" />
          <select name="status" defaultValue={sp.status ?? ""} className="input max-w-44"><option value="">All statuses</option>{["APPROVED", "PENDING", "REJECTED", "PAUSED"].map((s) => <option key={s}>{s}</option>)}</select>
          <button className="btn-ghost">Filter</button>
        </form>
        {!numbers?.length && <p className="mb-3 text-sm text-amber-700">Connect a number first — templates belong to its WhatsApp Business Account. <Link className="underline" href="/whatsapp/connections">Connections</Link></p>}
        {!list.length ? <EmptyState icon="template" title="No templates">Sync existing templates from Meta, or create one. Approval usually takes minutes to a few hours.</EmptyState> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((t) => {
              const comps = t.components as { type: string; text?: string; format?: string; buttons?: { text: string }[] }[];
              const body = comps.find((c) => c.type === "BODY")?.text;
              const header = comps.find((c) => c.type === "HEADER");
              const buttons = comps.find((c) => c.type === "BUTTONS")?.buttons ?? [];
              return (
                <div key={t.id} className="flex flex-col rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs font-semibold text-navy-900">{t.name}</span>
                    <span className={`badge ${STATUS[t.status] ?? "bg-slate-100"}`}>{t.status}</span>
                  </div>
                  <div className="flex-1 rounded-lg bg-[#e7f8ee] p-3 text-xs text-slate-800">
                    {header?.text && <div className="mb-1 font-semibold">{header.text}</div>}
                    {header && !header.text && header.format && <div className="mb-1 text-[11px] text-slate-500">[{header.format.toLowerCase()} header]</div>}
                    <div className="whitespace-pre-wrap">{body}</div>
                    {buttons.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{buttons.map((b, i) => <span key={i} className="rounded bg-white px-2 py-0.5 text-[11px] text-sky-700">{b.text}</span>)}</div>}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                    <span>{t.category} · {t.language}</span><span>synced {fmtDateTime(t.synced_at)}</span>
                  </div>
                  {t.status === "APPROVED" && <Link href={`/whatsapp/send?template=${encodeURIComponent(`${t.name}|${t.language}`)}`} className="btn-ghost btn-sm mt-2">Send this</Link>}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}

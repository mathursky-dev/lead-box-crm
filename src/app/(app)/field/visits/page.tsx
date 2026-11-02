import Link from "next/link";
import { requireProfile, isManager } from "@/lib/auth";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader, ErrorBox } from "@/components/static";
import { Kpi } from "@/components/kit";
import { PRESETS, rangeFor, istDate, fmtDateTime, type Preset } from "@/lib/dates";
import { FIELD_BUCKET, VISIT_OUTCOMES, fmtHours, mapUrl, outcomeLabel } from "@/lib/field";
import { FieldTabs } from "../tabs";
import { CsvButton } from "../csv-button";

export const metadata = { title: "Field visits" };
type SP = Record<string, string | undefined>;
const UUID = /^[0-9a-f-]{36}$/;

type Row = { id: string; user_id: string; lead_id: string | null; customer_name: string; purpose: string; started_at: string; ended_at: string | null;
  start_lat: number | null; start_lng: number | null; end_lat: number | null; end_lng: number | null; outcome: string | null; notes: string;
  photo_path: string | null; synced_late: boolean; lead: { lead_no: number; customer: { name: string | null; phone_e164: string } | null } | null };

export default async function VisitsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const manager = isManager(profile);
  const refs = await loadRefs();
  const sb = await createClient();
  const preset = (PRESETS.some((p) => p.value === sp.range) ? sp.range : "week") as Preset;
  const { from, to } = rangeFor(preset, sp.from, sp.to);
  const user = manager && sp.user && UUID.test(sp.user) ? sp.user : manager ? "" : profile.id;
  const outcome = VISIT_OUTCOMES.some((o) => o.value === sp.outcome) ? sp.outcome! : "";

  let q = sb.from("lb_field_visits")
    .select("id,user_id,lead_id,customer_name,purpose,started_at,ended_at,start_lat,start_lng,end_lat,end_lng,outcome,notes,photo_path,synced_late,lead:lb_leads(lead_no,customer:lb_customers(name,phone_e164))")
    .eq("company_id", profile.company_id).gte("started_at", from.toISOString()).lt("started_at", to.toISOString())
    .order("started_at", { ascending: false }).limit(500);
  if (user) q = q.eq("user_id", user);
  if (outcome) q = q.eq("outcome", outcome);
  const res = await q;
  if (res.error) {
    const missing = /lb_field_visits|schema cache/i.test(res.error.message);
    return <><FieldTabs /><ErrorBox message={missing ? "Field visits are not set up yet: the database update for Field force has to be run once (Supabase SQL)." : res.error.message} /></>;
  }
  const rows = (res.data ?? []) as unknown as Row[];
  const names = new Map(refs.users.map((u) => [u.id, u.full_name]));

  // Photos are private: short-lived signed links.
  const photos = new Map<string, string>();
  const paths = rows.map((r) => r.photo_path).filter(Boolean) as string[];
  if (paths.length && hasServiceRole()) {
    const { data } = await createAdminClient().storage.from(FIELD_BUCKET).createSignedUrls(paths, 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) photos.set(s.path, s.signedUrl);
  }

  const done = rows.filter((r) => r.ended_at);
  const mins = done.reduce((n, r) => n + (new Date(r.ended_at!).getTime() - new Date(r.started_at).getTime()) / 60000, 0);
  const who = (r: Row) => r.lead ? `${r.lead.customer?.name || r.lead.customer?.phone_e164 || ""} · LB-${r.lead.lead_no}` : r.customer_name || "—";
  const csv = [["Started", "User", "Customer / lead", "Purpose", "Outcome", "Minutes", "Report", "Map"],
    ...rows.map((r) => [fmtDateTime(r.started_at), names.get(r.user_id) ?? "", who(r), r.purpose, r.ended_at ? outcomeLabel(r.outcome) : "In progress",
      r.ended_at ? String(Math.round((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 60000)) : "", r.notes, mapUrl(r.start_lat, r.start_lng) ?? ""])];

  return (
    <div className="space-y-4">
      <FieldTabs />
      <PageHeader title="Field visits" icon="pin" tone="green" sub="Visits logged from the Field app with location, outcome and report. Visits on a lead also show on its timeline."
        actions={<CsvButton rows={csv} name={`visits-${istDate()}.csv`} />} />

      <form className="card flex flex-wrap items-end gap-2 p-3 text-sm" action="/field/visits">
        <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">Date</span>
          <select name="range" className="input" defaultValue={preset}>{PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        {preset === "custom" && <>
          <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">From</span><input type="date" name="from" className="input" defaultValue={sp.from} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">To</span><input type="date" name="to" className="input" defaultValue={sp.to} /></label>
        </>}
        {manager && <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">User</span>
          <select name="user" className="input" defaultValue={user}><option value="">Everyone</option>{refs.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>}
        <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">Outcome</span>
          <select name="outcome" className="input" defaultValue={outcome}><option value="">All</option>{VISIT_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <button className="btn-primary">Apply</button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Visits" value={rows.length} icon="pin" tone="green" />
        <Kpi label="Orders" value={rows.filter((r) => r.outcome === "order").length} icon="cart" tone="blue" />
        <Kpi label="Interested" value={rows.filter((r) => r.outcome === "interested" || r.outcome === "follow_up").length} icon="target" tone="amber" />
        <Kpi label="Avg time at visit" value={done.length ? fmtHours(mins / done.length) : "—"} icon="clock" tone="violet" />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px]">
          <thead className="border-b border-slate-100 bg-slate-50/60"><tr>
            <th className="th">Started</th><th className="th">User</th><th className="th">Customer / lead</th><th className="th">Outcome</th>
            <th className="th">Report</th><th className="th">Time</th><th className="th">Location</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td className="td text-slate-500" colSpan={7}>No visits in this period.</td></tr>}
            {rows.map((r) => {
              const sMap = mapUrl(r.start_lat, r.start_lng), eMap = mapUrl(r.end_lat, r.end_lng);
              const photo = r.photo_path ? photos.get(r.photo_path) : null;
              return (
                <tr key={r.id} className="align-top">
                  <td className="td whitespace-nowrap">{fmtDateTime(r.started_at)}</td>
                  <td className="td whitespace-nowrap">{names.get(r.user_id) ?? "User"}</td>
                  <td className="td">
                    {r.lead_id && r.lead ? <Link className="font-medium text-brand-700 hover:underline" href={`/leads/${r.lead_id}`}>{who(r)}</Link> : <span className="font-medium text-navy-900">{who(r)}</span>}
                    {r.purpose && <div className="text-xs text-slate-500">{r.purpose}</div>}
                  </td>
                  <td className="td whitespace-nowrap">{r.ended_at ? outcomeLabel(r.outcome) : <span className="badge bg-emerald-100 text-emerald-800">In progress</span>}</td>
                  <td className="td max-w-xs text-xs text-slate-600"><div className="line-clamp-3 whitespace-pre-line">{r.notes || "—"}</div>
                    {photo && <a href={photo} target="_blank" rel="noreferrer" className="text-brand-700 underline">Photo</a>}</td>
                  <td className="td whitespace-nowrap">{r.ended_at ? fmtHours((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 60000) : "—"}</td>
                  <td className="td whitespace-nowrap text-xs">
                    {sMap ? <a className="text-brand-700 underline" href={sMap} target="_blank" rel="noreferrer">Start</a> : <span className="text-slate-400">No GPS</span>}
                    {eMap && <> · <a className="text-brand-700 underline" href={eMap} target="_blank" rel="noreferrer">End</a></>}
                    {r.synced_late && <span className="ml-1 badge bg-slate-100 text-slate-600" title="Saved offline on the phone and synced later">offline</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

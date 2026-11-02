import Link from "next/link";
import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ErrorBox } from "@/components/static";
import { Kpi, PillTabs, Table } from "@/components/kit";
import { fmtDateTime } from "@/lib/dates";
import { FEEDBACK_STATUS, NPS_CLS, npsBucket, nps, nowMs } from "@/lib/care";

export const metadata = { title: "Feedback & NPS" };

type SP = Record<string, string | undefined>;
const VIEWS = [
  { key: "answered", label: "Answers" }, { key: "detractor", label: "Unhappy (0–6)" }, { key: "waiting", label: "Waiting for answer" }, { key: "all", label: "All" },
];

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const cid = profile.company_id;
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : "answered";
  const since = new Date(nowMs() - 90 * 86400000).toISOString();

  let q = sb.from("lb_feedback").select("id,status,score,comment,sent_at,answered_at,created_at,lead_id,lead:lb_leads(lead_no,customer:lb_customers(name,phone_e164))").eq("company_id", cid);
  if (view === "answered") q = q.eq("status", "answered").order("answered_at", { ascending: false });
  else if (view === "detractor") q = q.eq("status", "answered").lte("score", 6).order("answered_at", { ascending: false });
  else if (view === "waiting") q = q.in("status", ["pending", "sent", "not_sent"]).order("created_at", { ascending: false });
  else q = q.order("created_at", { ascending: false });
  const [{ data, error }, { data: scores }, { count: asked }, { data: s }] = await Promise.all([
    q.limit(200),
    sb.from("lb_feedback").select("score").eq("company_id", cid).eq("status", "answered").gte("answered_at", since).limit(5000),
    sb.from("lb_feedback").select("id", { count: "exact", head: true }).eq("company_id", cid).gte("created_at", since),
    sb.from("lb_care_settings").select("feedback_auto").eq("company_id", cid).maybeSingle(),
  ]);
  if (error) return <ErrorBox message={/lb_feedback|schema cache/i.test(error.message) ? "Customer care is not set up yet: the database update has to be run once (Supabase SQL)." : error.message} />;
  const list = (scores ?? []).map((x) => Number(x.score));
  const score = nps(list);
  const avg = list.length ? (list.reduce((a, b) => a + b, 0) / list.length).toFixed(1) : "—";
  const promo = list.filter((x) => x >= 9).length, detr = list.filter((x) => x <= 6).length;
  return (
    <div className="space-y-4">
      {!s?.feedback_auto && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
          Automatic feedback after a Won deal is off. {isAdmin(profile) ? <Link href="/care/settings" className="font-medium text-brand-700 underline">Turn it on</Link> : "Ask your admin to turn it on."} You can always send the feedback link from a lead (Customer care panel).
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="NPS (90 days)" value={score == null ? "—" : score} sub="% promoters − % detractors" icon="heart" tone={score == null ? "slate" : score >= 30 ? "green" : score >= 0 ? "amber" : "red"} />
        <Kpi label="Average score" value={avg} sub={`${list.length} answer${list.length === 1 ? "" : "s"}`} icon="trophy" tone="blue" />
        <Kpi label="Promoters / Unhappy" value={`${promo} / ${detr}`} icon="target" tone="violet" />
        <Kpi label="Response rate" value={asked ? `${Math.round((list.length / asked) * 100)}%` : "—"} sub={`${asked ?? 0} asked`} icon="send" tone="amber" />
      </div>
      <PillTabs label="Feedback views" tabs={VIEWS.map((v) => ({ href: `/care/feedback?view=${v.key}`, label: v.label, active: v.key === view }))} />
      <div className="card overflow-hidden">
        <Table head={["Customer", "Lead", "Score", "Comment", "Status", "When"]} empty={data?.length ? undefined : "Nothing here yet."}>
          {(data ?? []).map((f) => {
            const lead = f.lead as unknown as { lead_no: number; customer: { name: string | null; phone_e164: string } | null } | null;
            const st = FEEDBACK_STATUS[f.status as string] ?? FEEDBACK_STATUS.pending;
            const sc = f.score as number | null;
            return (
              <tr key={f.id as string}>
                <td className="td">{lead?.customer?.name || "—"}<div className="text-xs text-slate-500">{lead?.customer?.phone_e164}</div></td>
                <td className="td"><Link href={`/leads/${f.lead_id}`} className="text-brand-700 hover:underline">LB-{lead?.lead_no}</Link></td>
                <td className="td">{sc == null ? "—" : <span className={`rounded px-2 py-0.5 text-sm font-bold ${NPS_CLS[npsBucket(sc)]}`}>{sc}/10</span>}</td>
                <td className="td max-w-sm whitespace-pre-line text-slate-700">{(f.comment as string) || "—"}</td>
                <td className="td"><span className={`rounded px-1.5 text-[10px] font-bold uppercase ${st.cls}`}>{st.label}</span></td>
                <td className="td whitespace-nowrap text-xs text-slate-500">{fmtDateTime((f.answered_at ?? f.sent_at ?? f.created_at) as string)}</td>
              </tr>
            );
          })}
        </Table>
      </div>
    </div>
  );
}

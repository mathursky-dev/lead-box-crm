import Link from "next/link";
import { requireProfile, isAdmin, isManager } from "@/lib/auth";
import { createClient, createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader, ErrorBox } from "@/components/static";
import { Kpi, PillTabs } from "@/components/kit";
import { PRESETS, rangeFor, istDate, fmtDay, fmtDateTime, type Preset } from "@/lib/dates";
import { EXPENSE_CATEGORIES, EXPENSE_STATUSES, FIELD_BUCKET, categoryLabel, expenseStatusOf, rupees } from "@/lib/field";
import { FieldTabs } from "../tabs";
import { CsvButton } from "../csv-button";
import { ExpenseActions, BulkApprove } from "./actions";

export const metadata = { title: "Expenses" };
type SP = Record<string, string | undefined>;
const UUID = /^[0-9a-f-]{36}$/;

type Row = { id: string; expense_no: number; user_id: string; expense_date: string; category: string; amount: number; km: number | null; description: string;
  lead_id: string | null; receipt_path: string | null; status: string; reviewed_by: string | null; reviewed_at: string | null; review_note: string;
  paid_at: string | null; created_at: string; lead: { lead_no: number; customer: { name: string | null } | null } | null };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { profile } = await requireProfile();
  const admin = isAdmin(profile), manager = isManager(profile);
  const refs = await loadRefs();
  const sb = await createClient();
  const preset = (PRESETS.some((p) => p.value === sp.range) ? sp.range : "month") as Preset;
  const { from, to } = rangeFor(preset, sp.from, sp.to);
  const fromYmd = istDate(from), toYmd = istDate(new Date(to.getTime() - 1));
  const user = manager && sp.user && UUID.test(sp.user) ? sp.user : manager ? "" : profile.id;
  const status = EXPENSE_STATUSES.some((s) => s.value === sp.status) ? sp.status! : "";
  const cat = EXPENSE_CATEGORIES.some((c) => c.value === sp.cat) ? sp.cat! : "";
  const focus = sp.id && UUID.test(sp.id) ? sp.id : "";

  // A notification link (?id=) opens that claim whatever the filters.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = (q: any) => {
    q = q.eq("company_id", profile.company_id);
    if (focus) return q.eq("id", focus);
    // Pending claims are listed whatever their date, so nothing waits unseen.
    if (status !== "pending") q = q.gte("expense_date", fromYmd).lte("expense_date", toYmd);
    if (user) q = q.eq("user_id", user);
    if (cat) q = q.eq("category", cat);
    return q;
  };
  const SEL = "id,expense_no,user_id,expense_date,category,amount,km,description,lead_id,receipt_path,status,reviewed_by,reviewed_at,review_note,paid_at,created_at,lead:lb_leads(lead_no,customer:lb_customers(name))";
  const [res, all] = await Promise.all([
    (status ? base(sb.from("lb_expenses").select(SEL)).eq("status", status) : base(sb.from("lb_expenses").select(SEL)))
      .order("expense_date", { ascending: false }).order("created_at", { ascending: false }).limit(500),
    base(sb.from("lb_expenses").select("status,amount,user_id")).limit(10000),
  ]);
  if (res.error) {
    const missing = /lb_expenses|schema cache/i.test(res.error.message);
    return <><FieldTabs /><ErrorBox message={missing ? "Expenses are not set up yet: the database update for Field force has to be run once (Supabase SQL)." : res.error.message} /></>;
  }
  const rows = (res.data ?? []) as unknown as Row[];
  const totals = (all.data ?? []) as { status: string; amount: number; user_id: string }[];
  const sum = (s: string) => totals.filter((t) => t.status === s).reduce((n, t) => n + Number(t.amount), 0);
  const count = (s: string) => totals.filter((t) => t.status === s).length;
  const names = new Map(refs.users.map((u) => [u.id, u.full_name]));
  // Can the viewer approve this row? Admin: any. Team leader: their team's (RLS shows only those), not their own.
  const canReview = (r: Row) => admin || (profile.role === "team_leader" && r.user_id !== profile.id);
  const reviewable = rows.filter((r) => r.status === "pending" && canReview(r)).map((r) => r.id);

  const receipts = new Map<string, string>();
  const paths = rows.map((r) => r.receipt_path).filter(Boolean) as string[];
  if (paths.length && hasServiceRole()) {
    const { data } = await createAdminClient().storage.from(FIELD_BUCKET).createSignedUrls(paths, 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) receipts.set(s.path, s.signedUrl);
  }

  const qs = (patch: SP) => "/field/expenses?" + new URLSearchParams(Object.entries({ ...sp, id: undefined, ...patch } as SP).filter((e): e is [string, string] => !!e[1])).toString();
  const csv = [["No", "Date", "User", "Type", "Amount", "Km", "Details", "Lead", "Status", "Reviewed by", "Review note"],
    ...rows.map((r) => [`EXP-${r.expense_no}`, r.expense_date, names.get(r.user_id) ?? "", categoryLabel(r.category), String(r.amount), r.km == null ? "" : String(r.km),
      r.description, r.lead ? `LB-${r.lead.lead_no}` : "", expenseStatusOf(r.status).label, r.reviewed_by ? names.get(r.reviewed_by) ?? "" : "", r.review_note])];

  return (
    <div className="space-y-4">
      <FieldTabs />
      <PageHeader title="Expense claims" icon="rupee" tone="amber"
        sub={manager ? "Travel and field expenses sent from the Field app. Team leaders approve their team's claims; admins approve any claim and mark approved ones paid." : "Your travel and field expense claims. Add new ones from the Field app."}
        actions={<><CsvButton rows={csv} name={`expenses-${istDate()}.csv`} /><Link href="/field" className="btn-primary">Add expense</Link></>} />

      <PillTabs label="Status" tabs={[{ href: qs({ status: undefined }), label: "All", active: !status && !focus },
        ...EXPENSE_STATUSES.map((s) => ({ href: qs({ status: s.value }), label: s.label, active: status === s.value && !focus, count: s.value === "pending" ? count("pending") : undefined }))]} />

      <form className="card flex flex-wrap items-end gap-2 p-3 text-sm" action="/field/expenses">
        {status && <input type="hidden" name="status" value={status} />}
        <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">Date</span>
          <select name="range" className="input" defaultValue={preset}>{PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        {preset === "custom" && <>
          <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">From</span><input type="date" name="from" className="input" defaultValue={sp.from} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">To</span><input type="date" name="to" className="input" defaultValue={sp.to} /></label>
        </>}
        {manager && <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">User</span>
          <select name="user" className="input" defaultValue={user}><option value="">Everyone</option>{refs.users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>}
        <label className="flex flex-col gap-1"><span className="text-xs text-slate-500">Type</span>
          <select name="cat" className="input" defaultValue={cat}><option value="">All types</option>{EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{categoryLabel(c.value)}</option>)}</select></label>
        <button className="btn-primary">Apply</button>
        {status === "pending" && <span className="text-xs text-slate-500">Pending claims of every date are shown.</span>}
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Pending" value={rupees(sum("pending"))} sub={`${count("pending")} claims`} icon="clock" tone="amber" href={qs({ status: "pending" })} />
        <Kpi label="Approved (to pay)" value={rupees(sum("approved"))} sub={`${count("approved")} claims`} icon="check" tone="green" href={qs({ status: "approved" })} />
        <Kpi label="Paid" value={rupees(sum("paid"))} sub={`${count("paid")} claims`} icon="wallet" tone="blue" href={qs({ status: "paid" })} />
        <Kpi label="Rejected" value={rupees(sum("rejected"))} sub={`${count("rejected")} claims`} icon="xCircle" tone="red" href={qs({ status: "rejected" })} />
      </div>

      {reviewable.length > 1 && <BulkApprove ids={reviewable} total={rows.filter((r) => reviewable.includes(r.id)).reduce((n, r) => n + Number(r.amount), 0)} />}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-slate-100 bg-slate-50/60"><tr>
            <th className="th">Date</th><th className="th">User</th><th className="th">Type</th><th className="th text-right">Amount</th>
            <th className="th">Details</th><th className="th">Receipt</th><th className="th">Status</th><th className="th"></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td className="td text-slate-500" colSpan={8}>No expense claims here.</td></tr>}
            {rows.map((r) => {
              const st = expenseStatusOf(r.status);
              const rec = r.receipt_path ? receipts.get(r.receipt_path) : null;
              return (
                <tr key={r.id} className={`align-top ${focus === r.id ? "bg-amber-50/60" : ""}`}>
                  <td className="td whitespace-nowrap">{fmtDay(r.expense_date + "T12:00:00+05:30")}<div className="text-xs text-slate-400">EXP-{r.expense_no}</div></td>
                  <td className="td whitespace-nowrap">{names.get(r.user_id) ?? "User"}</td>
                  <td className="td whitespace-nowrap">{categoryLabel(r.category)}{r.km != null && <div className="text-xs text-slate-500">{r.km} km</div>}</td>
                  <td className="td whitespace-nowrap text-right font-semibold text-navy-900">{rupees(Number(r.amount))}</td>
                  <td className="td max-w-xs text-xs text-slate-600">{r.description || "—"}
                    {r.lead_id && r.lead && <div><Link href={`/leads/${r.lead_id}`} className="text-brand-700 hover:underline">LB-{r.lead.lead_no}{r.lead.customer?.name ? ` · ${r.lead.customer.name}` : ""}</Link></div>}</td>
                  <td className="td text-xs">{rec ? <a href={rec} target="_blank" rel="noreferrer" className="text-brand-700 underline">View</a> : r.receipt_path ? "Saved" : <span className="text-slate-400">None</span>}</td>
                  <td className="td text-xs"><span className={`badge ${st.cls}`}>{st.label}</span>
                    {r.reviewed_by && <div className="mt-1 text-slate-500">by {names.get(r.reviewed_by) ?? "manager"} · {fmtDateTime(r.reviewed_at)}</div>}
                    {r.review_note && <div className="mt-0.5 text-slate-600">“{r.review_note}”</div>}
                    {r.paid_at && <div className="mt-0.5 text-slate-500">Paid {fmtDay(r.paid_at)}</div>}</td>
                  <td className="td"><ExpenseActions id={r.id} status={r.status} canReview={r.status === "pending" && canReview(r)}
                    canPay={admin && r.status === "approved"} canDelete={r.status === "pending" && (r.user_id === profile.id || admin)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

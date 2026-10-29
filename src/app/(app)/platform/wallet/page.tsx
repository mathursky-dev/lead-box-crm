import Link from "next/link";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { Panel, Table } from "@/components/kit";
import { fmtDateTime } from "@/lib/dates";
import { inr } from "@/lib/plans";
import { ReviewForm, UpiForm } from "./forms";

export const metadata = { title: "Wallet payments" };

const STATUS: Record<string, [string, string]> = {
  pending: ["Pending", "bg-amber-50 text-amber-700"], approved: ["Approved", "bg-brand-50 text-brand-700"], rejected: ["Rejected", "bg-red-50 text-red-700"],
};

/** Super Admin: UPI ID companies pay to, and the queue of UPI payments to verify. Access is checked in ../layout.tsx. */
export default async function PlatformWalletPage() {
  if (!hasServiceRole()) return <ErrorBox message="SUPABASE_SERVICE_ROLE_KEY is missing on the server, so the platform console cannot load." />;
  const db = createAdminClient();
  const [{ data: settings }, { data: pending, error }, { data: recent }, { data: companies }] = await Promise.all([
    db.from("lb_platform_settings").select("upi_id,upi_name").maybeSingle(),
    db.from("lb_wallet_topups").select("id,company_id,amount,utr,created_at,requested_by").eq("status", "pending").order("created_at"),
    db.from("lb_wallet_topups").select("id,company_id,amount,utr,status,note,reviewed_at").neq("status", "pending").order("reviewed_at", { ascending: false }).limit(30),
    db.from("lb_companies").select("id,name"),
  ]);
  if (error) return <ErrorBox message={error.message} />;
  const name = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const company = (id: string) => <Link href={`/platform/companies/${id}`} className="font-medium text-navy-900 hover:text-brand-700 hover:underline">{name.get(id) ?? "—"}</Link>;

  return (
    <>
      <PageHeader icon="wallet" tone="violet" title="Wallet payments" sub="Companies pay your UPI ID and submit the UTR. Match it with your bank statement, then approve to credit their wallet." />

      <Panel title="Your UPI ID" icon="rupee" tone="violet" className="mb-5"
        sub={settings?.upi_id ? "Shown to every company on their Wallet page as a QR and pay link." : "Not set yet, so companies cannot add balance by UPI."}>
        <UpiForm upiId={settings?.upi_id ?? null} upiName={settings?.upi_name ?? null} />
      </Panel>

      <Panel title={`Waiting for verification (${(pending ?? []).length})`} icon="clock" tone="amber" className="mb-5">
        <Table head={["Submitted", "Company", "Amount", "UTR", ""]} empty={(pending ?? []).length ? undefined : "Nothing to verify."}>
          {(pending ?? []).map((t) => (
            <tr key={t.id}>
              <td className="td text-slate-500">{fmtDateTime(t.created_at)}</td>
              <td className="td">{company(t.company_id)}</td>
              <td className="td font-semibold">{inr(Number(t.amount))}</td>
              <td className="td font-mono text-xs">{t.utr}</td>
              <td className="td"><ReviewForm id={t.id} amount={inr(Number(t.amount))} /></td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Recently reviewed" icon="list" tone="slate">
        <Table head={["Reviewed", "Company", "Amount", "UTR", "Status"]} empty={(recent ?? []).length ? undefined : "No reviewed payments yet."}>
          {(recent ?? []).map((t) => (
            <tr key={t.id}>
              <td className="td text-slate-500">{fmtDateTime(t.reviewed_at)}</td>
              <td className="td">{company(t.company_id)}</td>
              <td className="td">{inr(Number(t.amount))}</td>
              <td className="td font-mono text-xs">{t.utr}</td>
              <td className="td"><span className={`badge ${STATUS[t.status]?.[1] ?? ""}`}>{STATUS[t.status]?.[0] ?? t.status}</span>{t.note && <div className="mt-0.5 text-xs text-slate-500">{t.note}</div>}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}

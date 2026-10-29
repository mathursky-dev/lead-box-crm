import { requireProfile, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { Kpi, Panel, Table, Notice } from "@/components/kit";
import { fmtDateTime } from "@/lib/dates";
import { inr } from "@/lib/plans";
import { topupNote } from "@/lib/upi";
import { AddBalance } from "./add-balance";

export const metadata = { title: "Wallet" };

const TXN_LABEL: Record<string, string> = { wallet_add: "Balance added", waba_topup: "Moved to number credits", waba_usage: "Message charges", adjustment: "Adjustment" };
const STATUS: Record<string, [string, string]> = {
  pending: ["Verifying", "bg-amber-50 text-amber-700"], approved: ["Added", "bg-brand-50 text-brand-700"], rejected: ["Rejected", "bg-red-50 text-red-700"],
};
const rupees = (n: number | string | null | undefined) => inr(Math.round(Number(n ?? 0) * 100) / 100);

export default async function WalletPage() {
  const { profile, company } = await requireProfile();
  const admin = isAdmin(profile);
  const sb = await createClient();
  // super_admin RLS can read every company, so scope each query explicitly.
  const [{ data: wallet, error }, { data: topups }, { data: txns }, { data: settings }] = await Promise.all([
    sb.from("lb_wallets").select("balance,updated_at").eq("company_id", profile.company_id).maybeSingle(),
    sb.from("lb_wallet_topups").select("id,amount,utr,status,note,created_at,reviewed_at").eq("company_id", profile.company_id).order("created_at", { ascending: false }).limit(20),
    sb.from("lb_wallet_txns").select("id,kind,amount,wallet_after,reference,created_at").eq("company_id", profile.company_id).order("created_at", { ascending: false }).limit(20),
    sb.from("lb_platform_settings").select("upi_id,upi_name").maybeSingle(),
  ]);
  const pending = (topups ?? []).filter((t) => t.status === "pending");
  const upi = settings?.upi_id && settings.upi_name ? { id: settings.upi_id, name: settings.upi_name } : null;

  return (
    <>
      <PageHeader icon="wallet" tone="amber" title="Wallet" sub={`${company.name} · prepaid balance for WhatsApp message credits`} />
      {error && <div className="mb-4"><ErrorBox message={error.message} /></div>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Wallet balance" value={rupees(wallet?.balance)} sub={wallet ? `Updated ${fmtDateTime(wallet.updated_at)}` : "No balance added yet"} icon="wallet" tone="amber" />
        <Kpi label="Waiting for verification" value={rupees(pending.reduce((s, t) => s + Number(t.amount), 0))} sub={`${pending.length} UPI payment${pending.length === 1 ? "" : "s"}`} icon="clock" tone="blue" />
        <Kpi label="Last added" value={rupees((txns ?? []).find((t) => t.kind === "wallet_add")?.amount ?? 0)} sub={fmtDateTime((txns ?? []).find((t) => t.kind === "wallet_add")?.created_at)} icon="rupee" tone="green" />
      </div>

      {admin && (
        <div id="add" className="mb-5 scroll-mt-20">
          <Panel title="Add balance with UPI" icon="rupee" tone="green" sub="Pay any amount by UPI, then enter the UTR. The balance is added after the payment is verified.">
            {upi ? <AddBalance upi={upi} note={topupNote(company.name)} /> : (
              <p className="text-sm text-slate-600">UPI payments are not set up yet. Contact Lead Box support to add balance.</p>
            )}
          </Panel>
        </div>
      )}

      <Notice>
        <b>WhatsApp template failing with “Business eligibility payment issue”?</b> Meta charges template messages to the payment method on your
        WhatsApp Business Account, not to this wallet. Add a card in{" "}
        <a className="font-medium underline" href="https://business.facebook.com/billing_hub/payment_settings" target="_blank" rel="noreferrer">Meta Business Suite → Billing &amp; payments</a>{" "}
        for the same business, then retry.
      </Notice>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="UPI payments" icon="list" tone="blue">
          <Table head={["Date", "Amount", "UTR", "Status"]} empty={(topups ?? []).length ? undefined : "No UPI payments yet."}>
            {(topups ?? []).map((t) => (
              <tr key={t.id}>
                <td className="td text-slate-500">{fmtDateTime(t.created_at)}</td>
                <td className="td font-medium">{rupees(t.amount)}</td>
                <td className="td font-mono text-xs">{t.utr}</td>
                <td className="td">
                  <span className={`badge ${STATUS[t.status]?.[1] ?? ""}`}>{STATUS[t.status]?.[0] ?? t.status}</span>
                  {t.status === "rejected" && t.note && <div className="mt-0.5 text-xs text-red-600">{t.note}</div>}
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
        <Panel title="Wallet history" icon="wallet" tone="amber">
          <Table head={["Date", "Entry", "Amount", "Balance"]} empty={(txns ?? []).length ? undefined : "No wallet entries yet."}>
            {(txns ?? []).map((t) => (
              <tr key={t.id}>
                <td className="td text-slate-500">{fmtDateTime(t.created_at)}</td>
                <td className="td">{TXN_LABEL[t.kind] ?? t.kind}{t.reference && <div className="text-xs text-slate-500">{t.reference}</div>}</td>
                <td className={`td font-medium ${t.kind === "wallet_add" ? "text-brand-700" : "text-slate-700"}`}>{t.kind === "wallet_add" ? "+" : "−"}{rupees(t.amount)}</td>
                <td className="td">{t.wallet_after === null ? "—" : rupees(t.wallet_after)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>
    </>
  );
}

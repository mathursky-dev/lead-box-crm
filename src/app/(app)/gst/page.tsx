import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ErrorBox, PageHeader } from "@/components/static";
import { Icon, Kpi, Notice, Panel, Table } from "@/components/kit";
import { istDate } from "@/lib/dates";
import { inr } from "@/lib/quotes";
import { loadGstr1, monthOk } from "@/lib/gst-server";
import { B2CL_LIMIT, einvoiceProblems, posLabel, posOf, taxLines, validGstin } from "@/lib/gst";

export const metadata = { title: "GST reports" };

const label = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const shift = (ym: string, by: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default async function GstPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const { profile } = await requireAdmin();
  const now = istDate().slice(0, 7);
  // Default: last month (that is the one being filed).
  const month = monthOk(sp.month) && sp.month! <= now ? sp.month! : shift(now, -1);
  let data: Awaited<ReturnType<typeof loadGstr1>>;
  try { data = await loadGstr1(profile.company_id, month); }
  catch (e) { return <><PageHeader icon="percent" title="GST reports" /><ErrorBox message={`GST reports are not set up yet (database update pending). ${e instanceof Error ? e.message : ""}`} /></>; }
  const { gstr1: g, seller, invoices } = data;
  const tax = g.totals.igst + g.totals.cgst + g.totals.sgst;
  const dl = (q: string) => `/api/gst/gstr1?month=${month}&${q}`;
  const einvReady = invoices.filter((i) => i.status !== "cancelled" && !i.irn && validGstin(i.buyer_gstin) && !einvoiceProblems(i, seller).length).length;

  return (
    <>
      <PageHeader icon="percent" tone="violet" title="GST reports"
        sub={<>GSTR-1 from your invoices (Quotes &amp; Invoices). GSTIN {seller.gstin || "not set"}{seller.state ? ` · ${posLabel(seller.state)}` : ""}.</>}
        actions={
          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 text-sm">
            <Link href={`/gst?month=${shift(month, -1)}`} className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Previous month">‹</Link>
            <span className="min-w-32 text-center font-semibold text-navy-900">{label(month)}</span>
            {month < now
              ? <Link href={`/gst?month=${shift(month, 1)}`} className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Next month">›</Link>
              : <span className="px-2 py-1 text-slate-300">›</span>}
          </div>
        } />

      {g.warnings.length > 0 && (
        <Notice>
          <b>Check before filing:</b>
          <ul className="mt-1 list-disc pl-4">{g.warnings.slice(0, 12).map((w) => <li key={w}>{w}</li>)}</ul>
          {g.warnings.length > 12 && <div className="mt-1">…and {g.warnings.length - 12} more.</div>}
          {!validGstin(seller.gstin) && <Link className="mt-1 inline-block font-medium underline" href="/settings/quotes">Open Settings → Quotes &amp; Payments</Link>}
        </Notice>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Invoices" value={g.totals.invoices} sub={g.docs?.cancelled ? `${g.docs.cancelled} cancelled` : undefined} icon="files" tone="blue" />
        <Kpi label="Taxable value" value={inr(g.totals.taxable)} icon="rupee" tone="green" />
        <Kpi label="Total GST" value={inr(tax)} sub={`IGST ${inr(g.totals.igst)} · CGST ${inr(g.totals.cgst)} · SGST ${inr(g.totals.sgst)}`} icon="percent" tone="violet" />
        <Kpi label="Invoice value" value={inr(g.totals.value)} icon="wallet" tone="amber" />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Download GSTR-1" icon="download" sub="Import in the GST offline tool, or upload the JSON on gst.gov.in → Returns → GSTR-1 → Prepare offline.">
          <div className="space-y-3 text-sm">
            <a className="btn-primary" href={dl("format=json")}><Icon name="download" /> GSTR-1 JSON (portal upload)</a>
            <div className="flex flex-wrap gap-2">
              {([["b2b", `B2B (${g.b2b.length})`], ["b2cl", `B2CL (${g.b2cl.length})`], ["b2cs", `B2CS (${g.b2cs.length})`], ["hsn_b2b", "HSN · B2B"], ["hsn_b2c", "HSN · B2C"], ["docs", "Documents"]] as const)
                .map(([k, l]) => <a key={k} className="btn-ghost btn-sm" href={dl(`format=csv&section=${k}`)}>{l} CSV</a>)}
            </div>
            <p className="text-xs text-slate-500">B2B = buyer has a GSTIN. B2CL = no GSTIN, other state, invoice above {inr(B2CL_LIMIT)}. B2CS = all other sales, grouped by state and rate. Please let your accountant check the file in the offline tool before filing.</p>
          </div>
        </Panel>
        <Panel title="e-Invoice (IRN)" icon="shield" sub="Needed if your turnover is above ₹5 crore, for B2B invoices.">
          <div className="space-y-3 text-sm">
            <a className={`btn-ghost ${einvReady ? "" : "pointer-events-none opacity-50"}`} href={`/api/gst/einvoice?month=${month}`}><Icon name="download" /> e-Invoice JSON · {einvReady} ready</a>
            <ol className="list-decimal space-y-1 pl-4 text-xs text-slate-600">
              <li>Download the JSON (NIC schema 1.1; only B2B invoices with all details and no IRN yet).</li>
              <li>Upload it on <b>einvoice1.gst.gov.in → e-Invoice → Bulk upload</b>, or through your GSP.</li>
              <li>Open each invoice here → <b>e-Invoice</b> → paste IRN, Ack no. and signed QR. The PDF then prints them.</li>
            </ol>
            <p className="text-xs text-slate-500">Automatic IRN in one click needs API access from a GSP (e.g. ClearTax, Masters India, IRIS). Share those API keys and it can be connected.</p>
          </div>
        </Panel>
      </div>

      <Panel title={`Invoices in ${label(month)}`} icon="files">
        <Table head={["Invoice", "Date", "Buyer", "Type", "Place of supply", "Taxable", "GST", "Total", "e-Invoice"]}
          empty={invoices.length ? undefined : "No invoices in this month. Make invoices from a lead (or convert a quotation)."}>
          {invoices.map((inv) => {
            const cancelled = inv.status === "cancelled";
            const pos = posOf(inv, seller);
            const inter = Boolean(seller.state && pos && pos !== seller.state);
            const lines = taxLines(inv.items, inv.discount, inter);
            const taxable = lines.reduce((s, l) => s + l.taxable, 0), t = lines.reduce((s, l) => s + l.igst + l.cgst + l.sgst, 0);
            const b2b = validGstin(inv.buyer_gstin);
            const type = b2b ? "B2B" : inter && inv.total > B2CL_LIMIT ? "B2CL" : "B2CS";
            const problems = b2b ? einvoiceProblems(inv, seller) : [];
            return (
              <tr key={inv.id} className={cancelled ? "text-slate-400 line-through" : ""}>
                <td className="td"><Link className="font-semibold text-brand-700 hover:underline" href={`/quotes/${inv.id}`}>{inv.doc_no}</Link></td>
                <td className="td whitespace-nowrap">{inv.issue_date}</td>
                <td className="td">{inv.buyer_legal_name || inv.customer_name || "—"}{inv.buyer_gstin && <div className="font-mono text-[11px] text-slate-500">{inv.buyer_gstin}</div>}</td>
                <td className="td">{cancelled ? "Cancelled" : type}</td>
                <td className="td text-xs">{posLabel(pos) || "—"}</td>
                <td className="td text-right">{inr(taxable)}</td>
                <td className="td text-right">{inr(t)}</td>
                <td className="td text-right font-medium">{inr(inv.total)}</td>
                <td className="td text-xs">{cancelled || !b2b ? "—" : inv.irn ? <span className="font-semibold text-emerald-700">IRN ✓</span>
                  : problems.length ? <span className="text-amber-700" title={problems.join("\n")}>Missing: {problems.length}</span>
                  : <a className="text-brand-700 hover:underline" href={`/api/gst/einvoice?id=${inv.id}`}>JSON</a>}</td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </>
  );
}

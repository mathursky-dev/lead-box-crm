import { redirect } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Empty } from "@/components/static";
import { fmtDateTime } from "@/lib/dates";
import { OfferForm, OfferButtons } from "./offer-forms";

export const metadata = { title: "Offers" };
const STATE: Record<string, string> = { draft: "bg-slate-100", pending_approval: "bg-amber-50 text-amber-800", approved: "bg-brand-100 text-brand-700", rejected: "bg-red-50 text-red-700" };

export default async function OffersPage() {
  const { profile } = await requireProfile();
  const manage = can(profile, "campaigns.manage"), approve = can(profile, "campaigns.approve");
  if (!manage && !approve) redirect("/nurture");
  const { data: offers } = await (await createClient()).from("lb_offers").select("*").order("created_at", { ascending: false });
  const now = new Date().toISOString();
  return (
    <>
      <PageHeader icon="gift" tone="amber" title="Offers" sub="Offers must be approved and inside their validity window at the moment of sending — otherwise the journey step or campaign message is held. Editing an offer sends it back for approval."
        actions={manage ? <OfferForm /> : null} />
      {!offers?.length ? <Empty title="No offers yet" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Offer</th><th className="th">Code</th><th className="th">Valid</th><th className="th">Status</th><th className="th"></th></tr></thead>
            <tbody className="divide-y">{offers.map((o) => {
              const live = o.status === "approved" && o.valid_from <= now && o.valid_to > now;
              return (
                <tr key={o.id}>
                  <td className="td"><div className="font-medium text-navy-900">{o.name}</div><div className="text-xs text-slate-500">{o.description}</div></td>
                  <td className="td font-mono text-xs">{o.code ?? "—"}</td>
                  <td className="td text-xs">{fmtDateTime(o.valid_from)} → {fmtDateTime(o.valid_to)}{o.valid_to <= now && <span className="ml-1 text-red-600">expired</span>}</td>
                  <td className="td"><span className={`badge ${STATE[o.status]}`}>{o.status.replace("_", " ")}</span>{live && <span className="badge ml-1 bg-brand-600 text-white">live</span>}
                    {o.rejection_reason && <div className="text-xs text-red-600">{o.rejection_reason}</div>}</td>
                  <td className="td text-right"><span className="inline-flex gap-1">{manage && <OfferForm offer={o} />}<OfferButtons id={o.id} status={o.status} manage={manage} approve={approve} /></span></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

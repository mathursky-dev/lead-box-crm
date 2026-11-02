import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { hsnMemory, quoteSettings, sellerOf } from "@/lib/quotes-server";
import { istDate } from "@/lib/dates";
import { QuoteEditor } from "../editor";

export const metadata = { title: "New quotation" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ lead?: string; kind?: string }> }) {
  const { lead: leadId, kind } = await searchParams;
  if (!leadId || !/^[0-9a-f-]{36}$/i.test(leadId)) notFound();
  const { profile } = await requireProfile();
  const sb = await createClient();
  const { data: lead } = await sb.from("lb_leads").select("id,lead_no,expected_value,product:lb_products(name),customer:lb_customers(name,phone_e164,gstin,location)")
    .eq("id", leadId).eq("company_id", profile.company_id).maybeSingle();
  if (!lead) notFound();
  const [{ data: products }, st] = await Promise.all([
    sb.from("lb_products").select("name").eq("company_id", profile.company_id).eq("is_active", true).order("name"),
    quoteSettings(profile.company_id),
  ]);
  const memory = await hsnMemory(profile.company_id);
  const today = istDate();
  const until = new Date(new Date(`${today}T00:00:00Z`).getTime() + (kind === "invoice" ? 7 : st.quote_validity_days) * 86400000).toISOString().slice(0, 10);
  const c = lead.customer as unknown as { name: string | null; phone_e164: string; gstin: string | null; location: string | null };
  const product = (lead.product as unknown as { name: string } | null)?.name ?? "";
  return (
    <QuoteEditor
      init={{ lead_id: lead.id, kind: kind === "invoice" ? "invoice" : "quotation", issue_date: today, valid_until: until, discount: 0, notes: "", terms: st.terms,
        buyer_gstin: c.gstin ?? "", buyer_legal_name: "", buyer_address: c.location ?? "", buyer_pincode: "", place_of_supply: "", reverse_charge: false,
        items: product ? [{ name: product, description: "", qty: 1, rate: Number(lead.expected_value) || 0, tax_pct: st.default_tax_pct }] : [] }}
      lead={{ id: lead.id, no: lead.lead_no, name: c.name ?? "", phone: c.phone_e164 }}
      products={(products ?? []).map((p) => p.name)} defaultTax={st.default_tax_pct} sellerState={sellerOf(st).state} hsnMemory={memory} />
  );
}

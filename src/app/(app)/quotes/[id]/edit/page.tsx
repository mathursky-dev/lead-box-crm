import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normQuote, quoteSettings } from "@/lib/quotes-server";
import { QuoteEditor } from "../../editor";

export const metadata = { title: "Edit quotation" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { profile } = await requireProfile();
  const sb = await createClient();
  const { data: row } = await sb.from("lb_quotes").select("*").eq("id", id).eq("company_id", profile.company_id).maybeSingle();
  if (!row) notFound();
  const q = normQuote(row);
  if (q.status === "paid" || q.status === "cancelled") redirect(`/quotes/${id}`);
  const [{ data: lead }, { data: products }, st] = await Promise.all([
    sb.from("lb_leads").select("id,lead_no,customer:lb_customers(name,phone_e164)").eq("id", q.lead_id).maybeSingle(),
    sb.from("lb_products").select("name").eq("company_id", profile.company_id).eq("is_active", true).order("name"),
    quoteSettings(profile.company_id),
  ]);
  if (!lead) notFound();
  const c = lead.customer as unknown as { name: string | null; phone_e164: string };
  return (
    <QuoteEditor
      init={{ id: q.id, lead_id: q.lead_id, kind: q.kind, doc_no: q.doc_no, issue_date: q.issue_date, valid_until: q.valid_until, items: q.items, discount: q.discount, notes: q.notes, terms: q.terms }}
      lead={{ id: lead.id, no: lead.lead_no, name: c.name ?? "", phone: c.phone_e164 }}
      products={(products ?? []).map((p) => p.name)} defaultTax={st.default_tax_pct} />
  );
}

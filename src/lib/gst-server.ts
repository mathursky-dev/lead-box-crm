import "server-only";
import { createAdminClient } from "./supabase/server";
import { quoteSettings, sellerOf, normQuote } from "./quotes-server";
import { buildGstr1, type GstInvoice } from "./gst";

// Loads a month's invoices of a company for GSTR-1 / e-invoice. Callers check the user is an admin.

export const monthOk = (m: string | null | undefined) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m ?? "");

const lastDay = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export async function gstInvoices(companyId: string, filter: { month?: string; ids?: string[] }): Promise<GstInvoice[]> {
  let q = createAdminClient().from("lb_quotes").select("*, lead:lb_leads(customer:lb_customers(name,location))")
    .eq("company_id", companyId).eq("kind", "invoice").order("issue_date").order("doc_no").limit(5000);
  if (filter.month) q = q.gte("issue_date", `${filter.month}-01`).lte("issue_date", lastDay(filter.month));
  if (filter.ids) q = q.in("id", filter.ids.slice(0, 500));
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const n = normQuote(r);
    const c = ((r.lead as { customer?: { name: string | null; location: string | null } } | null)?.customer) ?? { name: null, location: null };
    return {
      id: n.id, doc_no: n.doc_no, issue_date: n.issue_date, status: n.status, total: n.total, discount: n.discount, items: n.items,
      buyer_gstin: n.buyer_gstin ?? null, buyer_legal_name: n.buyer_legal_name ?? null, buyer_address: n.buyer_address ?? null,
      buyer_pincode: n.buyer_pincode ?? null, place_of_supply: n.place_of_supply ?? null, reverse_charge: Boolean(n.reverse_charge),
      customer_name: c.name, customer_location: c.location, irn: n.irn_cancelled_at ? null : n.irn ?? null,
    };
  });
}

export async function loadGstr1(companyId: string, month: string) {
  const [settings, invoices] = await Promise.all([quoteSettings(companyId), gstInvoices(companyId, { month })]);
  const seller = sellerOf(settings);
  return { seller, invoices, gstr1: buildGstr1(month, seller, invoices) };
}

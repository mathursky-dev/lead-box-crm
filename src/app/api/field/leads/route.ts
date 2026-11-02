import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Leads the field app keeps on the phone so a visit or note can be linked to a lead
// while offline: the 400 most recently active leads the user can see (RLS decides).
export async function GET() {
  const s = await getSession();
  if (!s?.profile) return NextResponse.json({ error: "Signed out" }, { status: 401 });
  const sb = await createClient();
  const { data, error } = await sb.from("lb_leads")
    .select("id,lead_no,customer:lb_customers(name,phone_e164,location)")
    .eq("company_id", s.profile.company_id).is("deleted_at", null)
    .order("last_activity_at", { ascending: false, nullsFirst: false }).limit(400);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const leads = (data ?? []).map((l) => {
    const c = l.customer as unknown as { name: string | null; phone_e164: string; location: string | null } | null;
    return { id: l.id as string, no: l.lead_no as number, name: c?.name ?? "", phone: c?.phone_e164 ?? "", loc: c?.location ?? "" };
  });
  return NextResponse.json({ leads, at: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
}

import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { careSettings } from "@/lib/care-server";
import { ReferralForm } from "./referral-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "You've been referred", robots: { index: false } };

// Public referral page: /ref/<code>. A friend leaves name + number; a lead with source "Referral" is created.
export default async function ReferralPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[A-Z0-9]{6,12}$/i.test(code)) notFound();
  const db = createAdminClient();
  const { data: c } = await db.from("lb_customers").select("company_id,name").eq("referral_code", code.toUpperCase()).maybeSingle();
  if (!c) notFound();
  const [s, { data: co }] = await Promise.all([careSettings(db, c.company_id), db.from("lb_companies").select("name,is_active").eq("id", c.company_id).maybeSingle()]);
  const open = Boolean(s?.referral_enabled && co?.is_active);
  const first = (c.name as string | null)?.split(" ")[0];
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="bg-emerald-700 px-6 py-6 text-white">
          <p className="text-sm opacity-80">{co?.name}</p>
          <h1 className="mt-1 text-xl font-bold">{first ? `${first} recommended us to you 🤝` : "You've been referred 🤝"}</h1>
          <p className="mt-1 text-sm opacity-90">Leave your details and our team will contact you on WhatsApp.</p>
        </div>
        <div className="p-6">
          {open ? <ReferralForm code={code.toUpperCase()} /> : <p className="text-center text-sm text-slate-600">This referral link is not active right now.</p>}
        </div>
      </div>
    </main>
  );
}

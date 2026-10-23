import { redirect } from "next/navigation";
import { requireProfile, isManager, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { PageHeader } from "@/components/static";
import { NewLeadForm } from "../lead-form";

export const metadata = { title: "New lead" };

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<{ repeat?: string }> }) {
  const { repeat } = await searchParams;
  const { profile } = await requireProfile();
  if (!can(profile, "leads.create")) redirect("/leads");
  const refs = await loadRefs();
  let defaults: { phone?: string; name?: string } | undefined;
  let repeatOf: { lead_no: number } | undefined;
  if (repeat) {
    const { data } = await (await createClient()).from("lb_leads").select("lead_no, customer:lb_customers(name, phone_e164)").eq("id", repeat).maybeSingle();
    if (data) {
      const c = data.customer as unknown as { name: string | null; phone_e164: string };
      defaults = { phone: c.phone_e164, name: c.name ?? undefined };
      repeatOf = { lead_no: data.lead_no };
    }
  }
  return (
    <>
      <PageHeader title={repeatOf ? "New repeat opportunity" : "New lead"} sub="Phone numbers are normalised and checked for duplicates within your company." />
      <div className="max-w-4xl"><NewLeadForm refs={refs} canChooseOwner={isManager(profile)} defaults={defaults} repeatOf={repeatOf} /></div>
    </>
  );
}

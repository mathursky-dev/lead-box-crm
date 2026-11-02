import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import { ErrorBox } from "@/components/static";
import { newStoreCode } from "@/lib/actions/store";
import { StoreSettingsForm } from "./store-form";

export const metadata = { title: "Store settings" };

export default async function StoreSettings() {
  const { profile, company } = await requireAdmin();
  const sb = await createClient();
  const [{ data: st, error }, refs, { data: bot }, { data: num }] = await Promise.all([
    sb.from("lb_stores").select("code,name,tagline,color,wa_phone,min_order,delivery_fee,free_delivery_above,ask_address,checkout_note,thank_you,source_id,is_active").eq("company_id", profile.company_id).maybeSingle(),
    loadRefs(),
    sb.from("lb_wa_bots").select("is_active").eq("company_id", profile.company_id).eq("name", "Store link (auto)").maybeSingle(),
    sb.from("lb_wa_numbers").select("display_phone").eq("company_id", profile.company_id).eq("is_active", true).not("display_phone", "is", null).limit(1).maybeSingle(),
  ]);
  // Chat payment fields (20261102140000 SQL); missing columns = section shows a "run SQL" note.
  const pay = await sb.from("lb_stores").select("upi_id,upi_name,wa_catalog_id,wa_pay_config").eq("company_id", profile.company_id).maybeSingle();
  if (error) return <ErrorBox message={/lb_stores|schema cache/i.test(error.message) ? "The store is not set up yet: the database update for the WhatsApp store has to be run once (Supabase SQL)." : error.message} />;
  return (
    <StoreSettingsForm
      store={st ?? null}
      defaults={{ code: await newStoreCode(), name: (company as { name?: string } | null)?.name ?? "", wa: String(num?.display_phone ?? "").replace(/\D/g, "") }}
      sources={refs.sources.filter((s) => s.is_active !== false)}
      autoReply={Boolean(bot?.is_active)}
      pay={pay.error ? null : (pay.data ?? { upi_id: null, upi_name: null, wa_catalog_id: null, wa_pay_config: null })}
    />
  );
}

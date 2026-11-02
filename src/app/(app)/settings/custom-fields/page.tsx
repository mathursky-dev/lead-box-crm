import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CustomField } from "@/lib/settings-shared";
import { FieldList } from "./field-list";

export const metadata = { title: "Custom Fields" };

export default async function SettingsCustomFields() {
  const cid = (await getSession())?.profile?.company_id ?? "";
  const { data } = await (await createClient()).from("lb_custom_fields").select("id,key,label,field_type,options,is_required,sort_order,is_active")
    .eq("company_id", cid).eq("entity", "lead").order("sort_order").order("label");
  return <FieldList rows={(data ?? []) as CustomField[]} />;
}

import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRefs } from "@/lib/data";
import type { CustomField } from "@/lib/settings-shared";
import { FormList, type FormRow } from "./form-list";

export const metadata = { title: "Forms" };

export default async function SettingsForms() {
  const cid = (await getSession())?.profile?.company_id ?? "";
  const sb = await createClient();
  const [{ data: forms }, { data: cf }, refs] = await Promise.all([
    sb.from("lb_forms").select("id,name,form_type,code,description,redirect_url,thank_you,bg_color,font,title_size,label_size,fields,source_id,product_id,department_id,tag_id,is_active,submissions,last_submit_at,created_at")
      .eq("company_id", cid).order("created_at", { ascending: false }),
    sb.from("lb_custom_fields").select("id,key,label,field_type,options,is_required,sort_order,is_active").eq("company_id", cid).eq("is_active", true).order("sort_order"),
    loadRefs(),
  ]);
  return (
    <FormList rows={(forms ?? []) as FormRow[]} customFields={(cf ?? []) as CustomField[]}
      refs={{ sources: refs.sources.filter((s) => s.is_active !== false), products: refs.products.filter((p) => p.is_active !== false),
        departments: refs.departments.filter((d) => d.is_active !== false), tags: refs.tags }} />
  );
}

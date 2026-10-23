import { loadRefs } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/static";
import { OrgList } from "../org-list";
import { QuickReplies } from "./quick-replies";

export const metadata = { title: "Catalog" };

export default async function CatalogPage() {
  const r = await loadRefs();
  const { data: qr } = await (await createClient()).from("lb_quick_replies").select("id,shortcut,title,body").order("shortcut");
  return (
    <>
      <PageHeader title="Products, sources, tags & quick replies" />
      <div className="grid gap-4 lg:grid-cols-3">
        <OrgList table="lb_products" title="Products / Services" items={r.products} />
        <OrgList table="lb_sources" title="Sources" items={r.sources} />
        <OrgList table="lb_tags" title="Tags" items={r.tags} color />
      </div>
      <div className="mt-4"><QuickReplies items={qr ?? []} /></div>
    </>
  );
}

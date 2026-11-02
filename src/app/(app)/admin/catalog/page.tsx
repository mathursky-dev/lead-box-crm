import Link from "next/link";
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
      <PageHeader icon="tag" tone="green" title="Products & quick replies"
        sub={<>Sources, tags, statuses, departments, custom fields and forms are in <Link href="/settings/statuses" className="font-medium text-brand-700 underline">Lead settings</Link>.</>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <OrgList table="lb_products" title="Products / Services" items={r.products} />
      </div>
      <div className="mt-4"><QuickReplies items={qr ?? []} /></div>
    </>
  );
}

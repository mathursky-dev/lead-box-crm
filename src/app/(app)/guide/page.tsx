import { requireProfile, isAdmin, can } from "@/lib/auth";
import { visibleFeatures } from "@/lib/feature-guide";
import { PageHeader } from "@/components/static";
import { GuideBrowser } from "./browser";

export const metadata = { title: "Features & Guide" };

export default async function GuidePage() {
  const { profile, features } = await requireProfile();
  const list = visibleFeatures({ admin: isAdmin(profile), superAdmin: profile.role === "super_admin", reports: can(profile, "reports.view"), features });
  return (
    <div>
      <PageHeader title="Features & Guide" icon="book" tone="violet"
        sub="Everything Lead Box CRM can do, with step-by-step how-to. Kuch bhi poochna ho to Ask AI se poochho." />
      <GuideBrowser ids={list.map((f) => f.id)} />
    </div>
  );
}

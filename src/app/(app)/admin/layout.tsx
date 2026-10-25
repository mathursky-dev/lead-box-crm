import { requireAdmin } from "@/lib/auth";
import { SectionTabs } from "@/components/section-tabs";

const TABS = [
  ["/admin/quick-setup", "Quick Setup", "bolt"], ["/admin/users", "Users", "contacts"], ["/admin/roles", "Roles & permissions", "shield"], ["/admin/org", "Organisation", "building"], ["/admin/integrations", "Integrations", "link"], ["/admin/numbers", "WhatsApp numbers", "phone"], ["/admin/templates", "Templates", "template"],
  ["/admin/allocation", "Allocation", "refresh"], ["/admin/statuses", "Statuses", "list"], ["/admin/catalog", "Products · Sources · Tags · Quick replies", "tag"],
  ["/admin/settings", "Settings", "gear"], ["/admin/audit", "Audit log", "clock"],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div>
      <SectionTabs label="Admin sections" tabs={TABS.map(([href, label, icon]) => ({ href, label, icon }))} />
      {children}
    </div>
  );
}

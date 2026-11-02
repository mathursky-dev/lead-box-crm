import { requireAdmin } from "@/lib/auth";
import { SectionTabs } from "@/components/section-tabs";

const TABS = [
  ["/settings/custom-fields", "Custom Fields", "grid"], ["/settings/forms", "Forms", "files"], ["/settings/statuses", "Manage Status", "check"],
  ["/settings/tags", "Tags", "tag"], ["/settings/sources", "Manage Source", "link"], ["/settings/departments", "Departments", "building"],
  ["/admin/allocation", "Lead Allocations", "refresh"], ["/settings/quotes", "Quotes & Payments", "rupee"],
] as const;

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5 text-sm text-slate-500"><span>Manage</span><span>›</span><span className="font-semibold text-navy-900">Lead settings</span></div>
      <SectionTabs label="Settings sections" tabs={TABS.map(([href, label, icon]) => ({ href, label, icon }))} />
      {children}
    </div>
  );
}

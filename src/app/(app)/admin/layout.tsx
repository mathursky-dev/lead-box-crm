import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

const TABS = [
  ["/admin/quick-setup", "Quick Setup"], ["/admin/users", "Users"], ["/admin/roles", "Roles & permissions"], ["/admin/org", "Organisation"], ["/admin/integrations", "Integrations"], ["/admin/numbers", "WhatsApp numbers"], ["/admin/templates", "Templates"],
  ["/admin/allocation", "Allocation"], ["/admin/statuses", "Statuses"], ["/admin/catalog", "Products · Sources · Tags · Quick replies"],
  ["/admin/settings", "Settings"], ["/admin/audit", "Audit log"],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div>
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 text-sm">
        {TABS.map(([href, label]) => (
          <Link key={href} href={href} className="whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-slate-600 hover:border-brand-500 hover:text-navy-900">{label}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

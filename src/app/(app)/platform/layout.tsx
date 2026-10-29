import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { SectionTabs } from "@/components/section-tabs";

const TABS = [
  { href: "/platform", label: "Companies", icon: "building" },
  { href: "/platform/plans", label: "Plans & pricing", icon: "rupee" },
  { href: "/platform/wallet", label: "Wallet payments", icon: "wallet" },
];

/** SaaS owner console: only the platform Super Admin sees it. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireProfile();
  if (profile.role !== "super_admin") redirect("/dashboard");
  return (
    <div>
      <SectionTabs label="Platform sections" tabs={TABS} />
      {children}
    </div>
  );
}

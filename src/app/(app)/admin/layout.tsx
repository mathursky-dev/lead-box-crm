import { requireAdmin, isAdmin } from "@/lib/auth";
import { getUserBrand } from "@/lib/brand";
import { SettingsFrame } from "@/components/settings-frame";
import { settingsGroups } from "@/lib/settings-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { features, profile } = await requireAdmin();
  const reseller = Boolean((await getUserBrand())?.is_owner) && isAdmin(profile);
  return <SettingsFrame groups={settingsGroups(features, { reseller })}>{children}</SettingsFrame>;
}

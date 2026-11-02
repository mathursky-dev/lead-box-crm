import { requireAdmin, isAdmin } from "@/lib/auth";
import { getUserBrand } from "@/lib/brand";
import { SettingsHub } from "@/components/settings-frame";
import { settingsGroups } from "@/lib/settings-nav";

export const metadata = { title: "Settings" };

export default async function SettingsIndex() {
  const { features, profile } = await requireAdmin();
  const reseller = Boolean((await getUserBrand())?.is_owner) && isAdmin(profile);
  return <SettingsHub groups={settingsGroups(features, { reseller })} />;
}

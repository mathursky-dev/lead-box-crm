import { requireAdmin } from "@/lib/auth";
import { SettingsHub } from "@/components/settings-frame";
import { settingsGroups } from "@/lib/settings-nav";

export const metadata = { title: "Settings" };

export default async function SettingsIndex() {
  const { features } = await requireAdmin();
  return <SettingsHub groups={settingsGroups(features)} />;
}

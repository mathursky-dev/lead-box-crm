import { requireAdmin } from "@/lib/auth";
import { SettingsFrame } from "@/components/settings-frame";
import { settingsGroups } from "@/lib/settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { features } = await requireAdmin();
  return <SettingsFrame groups={settingsGroups(features)}>{children}</SettingsFrame>;
}

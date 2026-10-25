import { redirect } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";
import { SectionTabs } from "@/components/section-tabs";
import { UpgradeNotice } from "@/components/upgrade";

export default async function NurtureLayout({ children }: { children: React.ReactNode }) {
  const { profile, features } = await requireProfile();
  if (!can(profile, "nurture.view")) redirect("/dashboard");
  if (!features.includes("nurture")) return <UpgradeNotice feature="Marketing & nurture" />;
  const tabs: [string, string, boolean, string][] = [
    ["/nurture", "Action queues", true, "list"],
    ["/nurture/journeys", "Journeys", true, "flow"],
    ["/nurture/campaigns", "Campaigns", can(profile, "campaigns.manage") || can(profile, "campaigns.approve"), "megaphone"],
    ["/nurture/segments", "Segments", can(profile, "campaigns.manage"), "layers"],
    ["/nurture/offers", "Offers", can(profile, "campaigns.manage") || can(profile, "campaigns.approve"), "gift"],
    ["/nurture/consent", "Consent & suppression", can(profile, "consent.manage"), "shield"],
    ["/nurture/performance", "Performance", true, "chart"],
    ["/nurture/logs", "Execution log", can(profile, "journeys.manage"), "pulse"],
    ["/nurture/knowledge", "AI knowledge", can(profile, "knowledge.manage"), "book"],
    ["/nurture/digest", "Digest", profile.role !== "agent", "mail"],
  ];
  return (
    <div>
      <SectionTabs label="Nurture sections" tabs={tabs.filter(([, , ok]) => ok).map(([href, label, , icon]) => ({ href, label, icon }))} />
      {children}
    </div>
  );
}

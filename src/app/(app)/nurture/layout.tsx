import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile, can } from "@/lib/auth";

export default async function NurtureLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireProfile();
  if (!can(profile, "nurture.view")) redirect("/dashboard");
  const tabs: [string, string, boolean][] = [
    ["/nurture", "Action queues", true],
    ["/nurture/journeys", "Journeys", true],
    ["/nurture/campaigns", "Campaigns", can(profile, "campaigns.manage") || can(profile, "campaigns.approve")],
    ["/nurture/segments", "Segments", can(profile, "campaigns.manage")],
    ["/nurture/offers", "Offers", can(profile, "campaigns.manage") || can(profile, "campaigns.approve")],
    ["/nurture/consent", "Consent & suppression", can(profile, "consent.manage")],
    ["/nurture/performance", "Performance", true],
    ["/nurture/logs", "Execution log", can(profile, "journeys.manage")],
    ["/nurture/knowledge", "AI knowledge", can(profile, "knowledge.manage")],
    ["/nurture/digest", "Digest", profile.role !== "agent"],
  ];
  return (
    <div>
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 text-sm">
        {tabs.filter(([, , ok]) => ok).map(([href, label]) => (
          <Link key={href} href={href} className="whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-slate-600 hover:border-brand-500 hover:text-navy-900">{label}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

import { requireProfile, isAdmin } from "@/lib/auth";
import { SectionTabs } from "@/components/section-tabs";
import { PageHeader } from "@/components/static";

export default async function CareLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireProfile();
  const tabs = [
    { href: "/care/appointments", label: "Appointments", icon: "calendar" },
    { href: "/care/feedback", label: "Feedback & NPS", icon: "heart" },
    { href: "/care/referrals", label: "Referrals", icon: "gift" },
    ...(isAdmin(profile) ? [{ href: "/care/meetings", label: "Meeting links", icon: "link" }, { href: "/care/settings", label: "Settings", icon: "gear" }] : []),
  ];
  return (
    <div>
      <PageHeader icon="heart" tone="green" title="Customer care"
        sub="Appointments booked from a link, feedback after every won deal, customer referrals and a self-service portal for your customers." />
      <SectionTabs label="Customer care sections" tabs={tabs} />
      {children}
    </div>
  );
}

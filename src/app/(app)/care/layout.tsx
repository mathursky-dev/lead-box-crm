import { requireProfile, isAdmin } from "@/lib/auth";
import { SectionTabs } from "@/components/section-tabs";
import { PageHeader } from "@/components/static";

export default async function CareLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireProfile();
  const tabs = [
    { href: "/care/appointments", label: "Appointments", icon: "calendar" },
    { href: "/care/feedback", label: "Feedback & NPS", icon: "heart" },
    { href: "/care/referrals", label: "Referrals", icon: "gift" },
    { href: "/care/tickets", label: "Tickets", icon: "help" },
    { href: "/care/renewals", label: "Renewals / AMC", icon: "refresh" },
    { href: "/care/loyalty", label: "Loyalty points", icon: "trophy" },
    { href: "/care/wishes", label: "Wishes", icon: "sparkle" },
    ...(isAdmin(profile) ? [{ href: "/care/settings", label: "Settings", icon: "gear" }] : []),
  ];
  return (
    <div>
      <PageHeader icon="heart" tone="green" title="Customer care"
        sub="Appointments, feedback, referrals, service tickets with SLA, AMC / renewal reminders, loyalty points, birthday wishes and a self-service portal." />
      <SectionTabs label="Customer care sections" tabs={tabs} />
      {children}
    </div>
  );
}

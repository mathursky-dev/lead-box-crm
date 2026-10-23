import { requireProfile, isAdmin, can, ROLE_LABEL } from "@/lib/auth";
import { cookies } from "next/headers";
import { Shell } from "@/components/shell";
import { DayBrief, type Brief } from "@/components/day-brief";
import { createClient } from "@/lib/supabase/server";

function istGreeting() {
  const now = new Date();
  const h = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }).format(now));
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" }).format(now);
  return { greeting, dateLabel };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, company } = await requireProfile();
  const nav = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/inbox", label: "Inbox" },
    { href: "/leads", label: "Leads" },
    { href: "/followups", label: "Follow-ups" },
    ...(can(profile, "nurture.view") ? [{ href: "/nurture", label: "Nurture & Recovery" }] : []),
    ...(can(profile, "customers.view") ? [{ href: "/customers", label: "Customers 360" }] : []),
    ...(can(profile, "reports.view") ? [{ href: "/reports", label: "360 Reports" }] : []),
    ...(can(profile, "leads.import") ? [{ href: "/import", label: "Import" }] : []),
    ...(isAdmin(profile) ? [{ href: "/admin", label: "Admin" }] : []),
  ];
  let brief: Brief | null = null;
  if ((await cookies()).get("lb_brief")) {
    const { data } = await (await createClient()).rpc("lb_day_brief");
    brief = data as Brief | null;
  }
  return (
    <Shell nav={nav} user={{ id: profile.id, availability: (profile as { availability?: string }).availability ?? "available", name: profile.full_name, role: ROLE_LABEL[profile.role], company: company?.name ?? "" }}>
      {children}
      {brief && <DayBrief name={profile.full_name} brief={brief} {...istGreeting()} />}
    </Shell>
  );
}

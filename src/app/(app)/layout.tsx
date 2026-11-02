import { requireProfile, isAdmin, can, ROLE_LABEL } from "@/lib/auth";
import { cookies } from "next/headers";
import { Shell, BackHome, type NavGroup, type CompanySwitch } from "@/components/shell";
import { DayBrief, type Brief } from "@/components/day-brief";
import { CallSync } from "@/components/call-sync";
import { OfflineSync } from "@/components/offline-sync";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { fmtDateTime } from "@/lib/dates";
import { isDemoCompany } from "@/lib/demo";
import { settingsGroups } from "@/lib/settings-nav";

function istGreeting() {
  const now = new Date();
  const h = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }).format(now));
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" }).format(now);
  return { greeting, dateLabel };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, company, billing, features, homeCompanyId } = await requireProfile();
  const demo = await isDemoCompany(profile.company_id);
  const onTrial = billing?.plan === "trial" && !(billing.paid_until && new Date(billing.paid_until) > new Date());
  const admin = isAdmin(profile);
  // Paid plan ending within 7 days: remind admins to renew (bell reminders also go out 7/3/1 days before).
  const renewDays = billing?.plan === "paid" && billing.paid_until ? Math.ceil((new Date(billing.paid_until).getTime() - new Date().getTime()) / 86400000) : null;
  const campaigns = can(profile, "campaigns.manage") || can(profile, "campaigns.approve");
  // Plan features: modules outside the company's plan are hidden (their pages show an upgrade notice).
  const nurture = can(profile, "nurture.view") && features.includes("nurture");
  // Sidebar: a few collapsible groups under section headings (Work / Grow / Insights / Admin).
  // Every page keeps the same permission check it had before; a group with no visible items is dropped.
  const it = (ok: boolean, href: string, label: string, keywords?: string) => (ok ? [{ href, label, ...(keywords ? { keywords } : {}) }] : []);
  const reports = can(profile, "reports.view");
  const nav: NavGroup[] = [
    { section: "Work", label: "Dashboard", icon: "grid", href: "/dashboard" },
    { section: "Work", label: "Sales", icon: "target", items: [
      { href: "/leads", label: "Leads" }, { href: "/followups", label: "Follow-ups" },
      { href: "/tasks", label: "Tasks", keywords: "todo to-do reminder" },
      { href: "/calls", label: "Calls", keywords: "call log recording mobile app" },
      ...it(can(profile, "customers.view"), "/customers", "Customers 360"),
      { href: "/quotes", label: "Quotes & Invoices", keywords: "quotation invoice estimate bill gst payment link" },
      { href: "/documents", label: "Documents", keywords: "files brochure pdf library" },
      ...it(can(profile, "leads.import"), "/import", "Import", "excel csv upload bulk"),
      ...it(admin, "/leads/duplicates", "Duplicate leads", "merge same number dedupe"),
    ] },
    { section: "Work", label: "Conversations", icon: "inbox", items: [
      { href: "/inbox", label: "Inbox" }, { href: "/whatsapp/live-chat", label: "Live chat" }, { href: "/whatsapp/contacts", label: "Contacts" },
      { href: "/email", label: "Email (Gmail)", keywords: "gmail mail google inbox" },
    ] },
    { section: "Work", label: "WhatsApp", icon: "chat", items: [
      { href: "/whatsapp", label: "Overview" }, { href: "/whatsapp/connections", label: "Connections" }, { href: "/whatsapp/templates", label: "Templates" },
      { href: "/whatsapp/send", label: "Send" }, { href: "/whatsapp/groups", label: "Groups", keywords: "group community invite link" }, { href: "/whatsapp/campaigns", label: "Campaigns", keywords: "broadcast bulk" }, { href: "/whatsapp/commerce", label: "Commerce" },
      { href: "/whatsapp/reports", label: "Reports" }, { href: "/whatsapp/settings", label: "Settings" },
    ] },
    { section: "Work", label: "Field Force", icon: "pin", items: [
      { href: "/field", label: "Field app", keywords: "check in check out attendance visit expense offline gps location" },
      { href: "/field/attendance", label: "Attendance", keywords: "check in present hours gps" },
      { href: "/field/visits", label: "Field visits", keywords: "visit report location meeting" },
      { href: "/field/expenses", label: "Expenses", keywords: "claim travel fuel reimbursement approval" },
    ] },
    ...(nurture ? [{ section: "Grow", label: "Marketing", icon: "megaphone", items: [
      { href: "/nurture", label: "Action queues" }, ...it(campaigns, "/nurture/campaigns", "Campaigns"),
      ...it(can(profile, "campaigns.manage"), "/nurture/segments", "Segments"), ...it(campaigns, "/nurture/offers", "Offers"),
      ...it(can(profile, "consent.manage"), "/nurture/consent", "Consent & suppression"), { href: "/nurture/performance", label: "Performance" },
      ...it(profile.role !== "agent", "/nurture/digest", "Digest"),
    ] }] : []),
    { section: "Grow", label: "Automation & AI", icon: "bot", items: [
      { href: "/whatsapp/chatbots", label: "Chatbots" }, { href: "/whatsapp/flows", label: "Flows" },
      ...it(admin, "/whatsapp/flows/new", "Flow builder"),
      ...it(nurture, "/nurture/journeys", "Journeys", "drip sequence"),
      ...it(nurture && can(profile, "journeys.manage"), "/nurture/logs", "Execution log"),
      ...it(nurture && can(profile, "knowledge.manage"), "/nurture/knowledge", "AI knowledge"),
    ] },
    { section: "Grow", label: "Store", icon: "cart", items: [
      { href: "/store", label: "Orders", keywords: "shop catalog mini-store order" },
      ...it(admin, "/store/products", "Store products"), ...it(admin, "/store/settings", "Store settings"),
    ] },
    { section: "Grow", label: "Customer care", icon: "heart", items: [
      { href: "/care/appointments", label: "Appointments", keywords: "booking calendar slot meeting visit" },
      { href: "/care/feedback", label: "Feedback & NPS", keywords: "rating review survey" },
      { href: "/care/referrals", label: "Referrals", keywords: "refer friend reward" },
      ...it(admin, "/care/settings", "Care settings"),
    ] },
    { section: "Insights", label: "Reports", icon: "chart", items: [
      { href: "/lead-reports", label: "Lead Reports" },
      ...it(reports, "/reports", "360 Reports"),
      { href: "/leaderboard", label: "Leaderboard", keywords: "targets ranking performance agents" },
      ...it(admin, "/profit-loss", "Profit & Loss", "p&l pnl ad spend revenue roi"),
    ] },
    ...(admin ? [{ section: "Admin", label: "Settings", icon: "gear", items: [
      { href: "/settings", label: "All settings", keywords: "admin manage configuration setup" },
      { href: "/admin/quick-setup", label: "Quick Setup" }, { href: "/admin/users", label: "Users", keywords: "team agent staff" },
      { href: "/settings/statuses", label: "Lead settings", keywords: "status source tags department custom fields forms" },
      { href: "/admin/lead-sources", label: "Integrations", keywords: "google ads indiamart justdial website chat widget zapier pabbly webhook sync api" },
      // Every other settings page stays reachable from menu search and Ctrl+K, without crowding the menu.
      ...settingsGroups(features).flatMap((g) => g.links).map((l) => ({ href: l.href, label: l.label, keywords: `${l.desc} ${l.keywords ?? ""}`, hidden: true })),
    ] }] : []),
    // SaaS owner console (companies, plans, billing) — platform Super Admin only.
    ...(profile.role === "super_admin" ? [{ section: "Admin", label: "Platform", icon: "building", items: [
      { href: "/platform", label: "Companies" }, { href: "/platform/plans", label: "Plans & pricing" }, { href: "/platform/wallet", label: "Wallet payments" },
      { href: "/platform/billing", label: "Plan payments", keywords: "subscription upi utr renew billing" },
    ] }] : []),
  ];
  // Quick Create: shortcuts to existing "new" screens, same permission checks as those pages.
  const quick = [
    ...it(can(profile, "leads.create"), "/leads/new", "New lead"),
    ...it(can(profile, "leads.import"), "/import", "Import leads (Excel / CSV)"),
    ...it(can(profile, "chats.send"), "/whatsapp/send", "Send WhatsApp message"),
    { href: "/tasks?new=1", label: "New task" },
    { href: "/field", label: "Check in / field visit" },
    { href: "/field?expense=1", label: "Add expense claim" },
    { href: "/documents", label: "Upload document" },
    ...it(nurture && can(profile, "campaigns.manage"), "/nurture/campaigns", "New campaign"),
    ...it(nurture && can(profile, "journeys.manage"), "/nurture/journeys/new", "New journey"),
    ...it(admin, "/whatsapp/chatbots", "New chatbot"),
    ...it(admin, "/whatsapp/flows/new", "New chatbot flow"),
    ...it(admin, "/admin/users", "Add user"),
  ];
  const sb = await createClient();
  const { data: wallet } = await sb.from("lb_wallets").select("balance").eq("company_id", profile.company_id).maybeSingle();
  // Admins always see the chip (it is where they add balance); others only once there is a wallet.
  const walletBalance = wallet ? Number(wallet.balance) : admin ? 0 : null;

  // Super Admin company switcher (top bar): every company, A-Z.
  const superAdmin = profile.role === "super_admin";
  const away = superAdmin && profile.company_id !== homeCompanyId;
  let switcher: CompanySwitch | null = null;
  if (superAdmin) {
    const { data: cos } = await sb.from("lb_companies").select("id,name,is_active").order("name");
    switcher = { current: profile.company_id, home: homeCompanyId, companies: (cos ?? []).map((c) => ({ id: c.id as string, name: c.name as string, active: c.is_active !== false })) };
  }

  let brief: Brief | null = null;
  if ((await cookies()).get("lb_brief")) {
    const { data } = await sb.rpc("lb_day_brief");
    brief = data as Brief | null;
  }
  return (
    <Shell nav={nav} quick={quick} wallet={walletBalance} switcher={switcher} user={{ id: profile.id, availability: (profile as { availability?: string }).availability ?? "available", name: profile.full_name, role: ROLE_LABEL[profile.role], company: company?.name ?? "" }}>
      {away && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900 sm:px-4 sm:text-sm">
          <span><span className="font-semibold">Super Admin view</span> · You are working inside <span className="font-semibold">{company?.name}</span>. Everything you see and change here is this company&apos;s data.</span>
          <BackHome className="font-semibold underline" />
        </div>
      )}
      {demo && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900 sm:px-4 sm:text-sm">
          <span className="font-semibold">Demo account</span> · Sample data. Feel free to try anything: it all resets every night at 3 AM, and WhatsApp messages are only simulated.
        </div>
      )}
      {onTrial && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Free trial ends {fmtDateTime(billing.trial_ends_at)}. <Link href="/billing" className="font-medium underline">Upgrade to keep access</Link>
        </div>
      )}
      {admin && !demo && renewDays != null && renewDays > 0 && renewDays <= 7 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Your plan ends in {renewDays} day{renewDays === 1 ? "" : "s"} ({fmtDateTime(billing!.paid_until)}). <Link href="/billing" className="font-medium underline">Renew now</Link> so your team keeps working.
        </div>
      )}
      {children}
      <CallSync userId={profile.id} />
      <OfflineSync userId={profile.id} />
      {brief && <DayBrief userId={profile.id} name={profile.full_name} brief={brief} {...istGreeting()} />}
    </Shell>
  );
}

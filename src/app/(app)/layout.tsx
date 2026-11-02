import { requireProfile, isAdmin, can, ROLE_LABEL } from "@/lib/auth";
import { cookies } from "next/headers";
import { Shell, BackHome, type NavGroup, type CompanySwitch } from "@/components/shell";
import { DayBrief, type Brief } from "@/components/day-brief";
import { CallSync } from "@/components/call-sync";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { fmtDateTime } from "@/lib/dates";
import { isDemoCompany } from "@/lib/demo";

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
  const campaigns = can(profile, "campaigns.manage") || can(profile, "campaigns.approve");
  // Plan features: modules outside the company's plan are hidden (their pages show an upgrade notice).
  const nurture = can(profile, "nurture.view") && features.includes("nurture");
  // Sidebar groups. Every page keeps the same permission check it had before; a group with no visible items is dropped.
  const it = (ok: boolean, href: string, label: string) => (ok ? [{ href, label }] : []);
  const nav: NavGroup[] = [
    { label: "Dashboard", icon: "grid", href: "/dashboard" },
    { label: "Lead Reports", icon: "chart", href: "/lead-reports" },
    ...(admin ? [{ label: "Profit & Loss", icon: "rupee", href: "/profit-loss" }] : []),
    { label: "Sales", icon: "target", items: [
      { href: "/leads", label: "Leads" }, { href: "/followups", label: "Follow-ups" }, { href: "/calls", label: "Calls", keywords: "call log recording mobile app" },
      { href: "/leaderboard", label: "Leaderboard", keywords: "targets ranking performance agents" },
      ...it(can(profile, "customers.view"), "/customers", "Customers 360"), ...it(can(profile, "leads.import"), "/import", "Import"),
    ] },
    { label: "Tasks", icon: "check", href: "/tasks" },
    { label: "Conversations", icon: "inbox", items: [
      { href: "/inbox", label: "Inbox" }, { href: "/whatsapp/live-chat", label: "Live chat" }, { href: "/whatsapp/contacts", label: "Contacts" },
    ] },
    { label: "Documents", icon: "files", href: "/documents" },
    { label: "Store", icon: "cart", items: [
      { href: "/store", label: "Orders", keywords: "shop catalog mini-store order" },
      ...it(admin, "/store/products", "Store products"), ...it(admin, "/store/settings", "Store settings"),
    ] },
    { label: "Quotes & Invoices", icon: "rupee", href: "/quotes" },
    { label: "Customer care", icon: "heart", items: [
      { href: "/care/appointments", label: "Appointments", keywords: "booking calendar slot meeting visit" },
      { href: "/care/feedback", label: "Feedback & NPS", keywords: "rating review survey" },
      { href: "/care/referrals", label: "Referrals", keywords: "refer friend reward" },
      ...it(admin, "/care/settings", "Care settings"),
    ] },
    { label: "WhatsApp", icon: "chat", items: [
      { href: "/whatsapp", label: "Overview" }, { href: "/whatsapp/connections", label: "Connections" }, { href: "/whatsapp/templates", label: "Templates" },
      { href: "/whatsapp/send", label: "Send" }, { href: "/whatsapp/campaigns", label: "Campaigns" }, { href: "/whatsapp/commerce", label: "Commerce" },
      { href: "/whatsapp/reports", label: "Reports" }, { href: "/whatsapp/settings", label: "Settings" },
    ] },
    ...(nurture ? [{ label: "Marketing", icon: "megaphone", items: [
      { href: "/nurture", label: "Action queues" }, ...it(campaigns, "/nurture/campaigns", "Campaigns"),
      ...it(can(profile, "campaigns.manage"), "/nurture/segments", "Segments"), ...it(campaigns, "/nurture/offers", "Offers"),
      ...it(can(profile, "consent.manage"), "/nurture/consent", "Consent & suppression"), { href: "/nurture/performance", label: "Performance" },
      ...it(profile.role !== "agent", "/nurture/digest", "Digest"),
    ] }] : []),
    { label: "Automation & AI", icon: "bot", items: [
      { href: "/whatsapp/chatbots", label: "Chatbots" }, { href: "/whatsapp/flows", label: "Flows" },
      ...it(admin, "/whatsapp/flows/new", "Flow builder"),
      ...it(nurture, "/nurture/journeys", "Journeys"),
      ...it(nurture && can(profile, "journeys.manage"), "/nurture/logs", "Execution log"),
      ...it(nurture && can(profile, "knowledge.manage"), "/nurture/knowledge", "AI knowledge"),
    ] },
    ...(can(profile, "reports.view") ? [{ label: "360 Reports", icon: "chart", href: "/reports" }] : []),
    ...(admin ? [
      { label: "Manage", icon: "gear", items: [
        { href: "/admin/quick-setup", label: "Quick Setup" }, { href: "/admin/users", label: "Users" }, { href: "/admin/roles", label: "Roles & permissions" },
        { href: "/admin/org", label: "Organisation" }, { href: "/admin/numbers", label: "WhatsApp numbers" }, { href: "/admin/templates", label: "Templates" },
        { href: "/admin/allocation", label: "Allocation" }, { href: "/leads/duplicates", label: "Duplicate leads", keywords: "merge same number dedupe" }, { href: "/settings", label: "Lead settings", keywords: "status source tags department custom fields forms quotes invoice razorpay payment" }, { href: "/admin/catalog", label: "Products · Quick replies" },
        { href: "/admin/alerts", label: "Follow-up alerts", keywords: "reminder missed push whatsapp notification" }, { href: "/admin/settings", label: "Settings" }, { href: "/admin/audit", label: "Audit log" },
      ] },
      { label: "Integrations", icon: "link", items: [
        { href: "/admin/integrations", label: "WhatsApp Cloud API" }, ...it(features.includes("fb_leads"), "/admin/fb-login", "Facebook Lead Ads"),
        { href: "/admin/lead-sources", label: "Lead sources", keywords: "google ads indiamart justdial website chat widget zapier pabbly webhook sync" },
        { href: "/admin/api", label: "API & webhooks", keywords: "api key rest developer zapier webhook integration software" },
      ] },
    ] : []),
    // SaaS owner console (companies, plans, billing) — platform Super Admin only.
    ...(profile.role === "super_admin" ? [{ label: "Platform", icon: "building", items: [
      { href: "/platform", label: "Companies" }, { href: "/platform/plans", label: "Plans & pricing" }, { href: "/platform/wallet", label: "Wallet payments" },
    ] }] : []),
  ];
  // Quick Create: shortcuts to existing "new" screens, same permission checks as those pages.
  const quick = [
    ...it(can(profile, "leads.create"), "/leads/new", "New lead"),
    ...it(can(profile, "leads.import"), "/import", "Import leads (Excel / CSV)"),
    ...it(can(profile, "chats.send"), "/whatsapp/send", "Send WhatsApp message"),
    { href: "/tasks?new=1", label: "New task" },
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
      {children}
      <CallSync userId={profile.id} />
      {brief && <DayBrief userId={profile.id} name={profile.full_name} brief={brief} {...istGreeting()} />}
    </Shell>
  );
}

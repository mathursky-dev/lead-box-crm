import { requireProfile, isAdmin, can, ROLE_LABEL, getPageAccess } from "@/lib/auth";
import { headers } from "next/headers";
import { allowed, pageForPath } from "@/lib/page-access";
import { cookies } from "next/headers";
import { Shell, BackHome, type NavGroup, type CompanySwitch } from "@/components/shell";
import { DayBrief, type Brief } from "@/components/day-brief";
import { CallSync } from "@/components/call-sync";
import { OfflineSync } from "@/components/offline-sync";
import { PresencePing } from "@/components/presence-ping";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { fmtDateTime } from "@/lib/dates";
import { isDemoCompany } from "@/lib/demo";
import { settingsGroups } from "@/lib/settings-nav";
import { LANG_COOKIE, parseLang, tr } from "@/lib/i18n";
import { brandCss, brandLogo, getUserBrand } from "@/lib/brand";

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
  // White-label: the company's partner brand (logo + colours), if any.
  const brand = await getUserBrand();
  const reseller = Boolean(brand?.is_owner) && isAdmin(profile);
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
  const navAll: NavGroup[] = [
    { section: "Work", label: "Dashboard", icon: "grid", href: "/dashboard" },
    { section: "Work", label: "Sales", icon: "target", items: [
      { href: "/leads", label: "Leads" }, { href: "/followups", label: "Follow-ups" },
      { href: "/tasks", label: "Tasks", keywords: "todo to-do reminder" },
      { href: "/calls", label: "Calls", keywords: "call log recording mobile app" },
      ...it(can(profile, "customers.view"), "/customers", "Customers 360"),
      { href: "/quotes", label: "Quotes & Invoices", keywords: "quotation invoice estimate bill gst payment link e-sign signature" },
      { href: "/commissions", label: "Commissions", keywords: "incentive payout agent earning deal" },
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
      ...(can(profile, "reports.view") ? [{ href: "/forecast", label: "AI sales forecast", keywords: "prediction next month product sales projection target" }] : []),
    ] },
    { section: "Grow", label: "Store", icon: "cart", items: [
      { href: "/store", label: "Orders", keywords: "shop catalog mini-store order" },
      ...it(admin, "/store/products", "Store products"),
      ...it(admin, "/store/purchases", "Purchase orders", "po purchase buy stock supplier vendor inward goods receive"),
      ...it(admin, "/store/vendors", "Vendors", "supplier vendor party purchase"),
      ...it(admin, "/store/settings", "Store settings"),
    ] },
    { section: "Grow", label: "Customer care", icon: "heart", items: [
      { href: "/care/appointments", label: "Appointments", keywords: "booking calendar slot meeting visit" },
      { href: "/care/feedback", label: "Feedback & NPS", keywords: "rating review survey" },
      { href: "/care/referrals", label: "Referrals", keywords: "refer friend reward" },
      { href: "/care/tickets", label: "Service tickets", keywords: "complaint support ticket sla service request after sales" },
      { href: "/care/renewals", label: "Renewals / AMC", keywords: "amc renewal subscription warranty service due reminder" },
      { href: "/care/loyalty", label: "Loyalty points", keywords: "points reward redeem discount loyalty" },
      { href: "/care/wishes", label: "Birthday wishes", keywords: "birthday anniversary wish greeting" },
      ...it(admin, "/care/settings", "Care settings"),
    ] },
    { section: "Insights", label: "Reports", icon: "chart", items: [
      { href: "/lead-reports", label: "Lead Reports" },
      ...it(reports, "/reports", "360 Reports"),
      ...it(reports, "/report-builder", "Report Builder", "custom report excel export pivot chart"),
      ...it(reports, "/win-loss", "Win / Loss", "lost reason won deal analysis"),
      { href: "/leaderboard", label: "Leaderboard", keywords: "targets ranking performance agents" },
      { href: "/targets", label: "Targets", keywords: "monthly target goal progress quota calls visits follow-ups agent" },
      { href: "/login-hours", label: "Login hours", keywords: "login logout time attendance present online active hours agent" },
      ...it(admin, "/profit-loss", "Profit & Loss", "p&l pnl ad spend revenue roi"),
      ...it(admin, "/gst", "GST reports", "gstr-1 gstr1 e-invoice irn hsn tax return accountant"),
    ] },
    { section: "Help", label: "Features & Guide", icon: "book", href: "/guide" },
    { section: "Help", label: "Download app", icon: "smartphone", href: "/download-app" },
    ...(admin ? [{ section: "Admin", label: "Settings", icon: "gear", items: [
      { href: "/settings", label: "All settings", keywords: "admin manage configuration setup" },
      { href: "/admin/quick-setup", label: "Quick Setup" }, { href: "/admin/users", label: "Users", keywords: "team agent staff" },
      { href: "/settings/statuses", label: "Lead settings", keywords: "status source tags department custom fields forms" },
      { href: "/admin/lead-sources", label: "Integrations", keywords: "google ads indiamart justdial website chat widget zapier pabbly webhook sync api" },
      // Every other settings page stays reachable from menu search and Ctrl+K, without crowding the menu.
      ...settingsGroups(features, { reseller }).flatMap((g) => g.links).map((l) => ({ href: l.href, label: l.label, keywords: `${l.desc} ${l.keywords ?? ""}`, hidden: true })),
    ] }] : []),
    // SaaS owner console (companies, plans, billing) — platform Super Admin only.
    ...(profile.role === "super_admin" ? [{ section: "Admin", label: "Platform", icon: "building", items: [
      { href: "/platform", label: "Companies" }, { href: "/platform/plans", label: "Plans & pricing" }, { href: "/platform/wallet", label: "Wallet payments" },
      { href: "/platform/billing", label: "Plan payments", keywords: "subscription upi utr renew billing" },
      { href: "/platform/brands", label: "White-label brands", keywords: "reseller partner logo domain branding" },
    ] }] : []),
  ];
  // Page-wise role access (Admin → Roles & permissions → Page access): hide pages this role cannot view.
  const pageAccess = await getPageAccess();
  const canSee = (href: string) => { const pg = pageForPath(href.split("?")[0]); return !pg || allowed(pageAccess, pg); };
  const nav: NavGroup[] = navAll
    .map((g) => (g.items ? { ...g, items: g.items.filter((i) => canSee(i.href)) } : g))
    .filter((g) => (g.items ? g.items.length > 0 : !g.href || canSee(g.href)));
  const path = (await headers()).get("x-lb-path") ?? "";
  // Onboarding wizard reminder for admins of a company that has not finished setup.
  let onboarding = false;
  if (admin && !path.startsWith("/onboarding")) {
    const { data: ob, error: obErr } = await createClient().then((c) => c.from("lb_companies").select("onboarded_at").eq("id", profile.company_id).maybeSingle());
    onboarding = !obErr && !!ob && !ob.onboarded_at;
  }
  // Quick Create: shortcuts to existing "new" screens, same permission checks as those pages.
  const quickAll = [
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
  const quick = quickAll.filter((q) => canSee(q.href));
  // Hindi / English: menu labels are translated here; the English label stays searchable.
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  const navT: NavGroup[] = lang === "en" ? nav : nav.map((g) => ({
    ...g, label: tr(lang, g.label),
    items: g.items?.map((i) => ({ ...i, label: tr(lang, i.label), keywords: `${i.label} ${i.keywords ?? ""}` })),
  }));
  const quickT = lang === "en" ? quick : quick.map((q) => ({ ...q, label: tr(lang, q.label), keywords: q.label }));

  const sb = await createClient();
  // Lost / Invalid reasons master: offered as suggestions in every "Reason" box (empty until the SQL is applied).
  const { data: reasonRows } = await sb.from("lb_lost_reasons").select("name,category").eq("company_id", profile.company_id).eq("is_active", true).order("sort_order").order("name");
  const reasons = (reasonRows ?? []) as { name: string; category: string }[];
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

  // Branch access: a user locked to one branch sees its name next to the company.
  let branchLabel = "";
  if ((profile as { branch_scope?: boolean }).branch_scope && profile.branch_id && profile.role !== "super_admin") {
    const { data: br } = await sb.from("lb_branches").select("name").eq("id", profile.branch_id).maybeSingle();
    if (br?.name) branchLabel = ` · ${br.name}`;
  }
  const css = brandCss(brand);

  let brief: Brief | null = null;
  if (jar.get("lb_brief")) {
    const { data } = await sb.rpc("lb_day_brief");
    brief = data as Brief | null;
  }
  return (
    <Shell nav={navT} quick={quickT} lang={lang} wallet={walletBalance} switcher={switcher} brand={brandLogo(brand)} user={{ id: profile.id, availability: (profile as { availability?: string }).availability ?? "available", name: profile.full_name, role: ROLE_LABEL[profile.role], company: (company?.name ?? "") + branchLabel }}>
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
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
      {onboarding && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900 sm:px-4">
          <span><span className="font-semibold">Finish setting up {company?.name}</span> · A few quick steps: WhatsApp number, team, lead stages and your first leads.</span>
          <Link href="/onboarding" className="btn-primary btn-sm">Continue setup</Link>
        </div>
      )}
      {children}
      {(["lost", "invalid"] as const).map((c) => (
        <datalist key={c} id={`lb-reasons-${c}`}>
          {reasons.filter((r) => r.category === c || r.category === "any").map((r) => <option key={r.name} value={r.name} />)}
        </datalist>
      ))}
      <CallSync userId={profile.id} />
      <OfflineSync userId={profile.id} />
      <PresencePing />
      {brief && <DayBrief userId={profile.id} name={profile.full_name} brief={brief} {...istGreeting()} />}
    </Shell>
  );
}

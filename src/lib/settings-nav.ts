// One list of every admin / settings page, grouped by category.
// Used by the Settings hub (/settings), the left list on every settings page,
// and the side menu search, so a page added here shows up everywhere.

export type SettingsLink = { href: string; label: string; icon: string; desc: string; keywords?: string; feature?: string };
export type SettingsGroup = { label: string; icon: string; tone: string; links: SettingsLink[] };

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { label: "Company & team", icon: "building", tone: "navy", links: [
    { href: "/onboarding", label: "Setup wizard", icon: "check", desc: "Step-by-step setup for a new company", keywords: "onboarding getting started setup steps" },
    { href: "/admin/quick-setup", label: "Quick Setup", icon: "bolt", desc: "Connect lead sources in one place", keywords: "onboarding start guide integrations" },
    { href: "/admin/settings", label: "Company settings", icon: "gear", desc: "Name, auto-create leads, SLA policy", keywords: "auto allocate nurture sla automation" },
    { href: "/admin/users", label: "Users", icon: "contacts", desc: "Add team members, reset passwords", keywords: "team agent staff login" },
    { href: "/admin/roles", label: "Roles & permissions", icon: "shield", desc: "Who can see and do what", keywords: "access rights" },
    { href: "/admin/org", label: "Organisation", icon: "building", desc: "Branches, departments, teams", keywords: "branch hierarchy manager team leader" },
    { href: "/billing", label: "Billing & plan", icon: "wallet", desc: "Your plan, renew, payments", keywords: "subscription payment renew upi razorpay invoice" },
    { href: "/admin/security", label: "Security & logins", icon: "key", desc: "OTP two-factor login, login history", keywords: "otp two factor 2fa authenticator login history sign in password" },
    { href: "/admin/export", label: "Data export / backup", icon: "download", desc: "Download all company data (ZIP)", keywords: "backup download all data excel csv zip" },
    { href: "/admin/audit", label: "Audit log", icon: "clock", desc: "Who changed what, and when", keywords: "history activity" },
  ] },
  { label: "Leads", icon: "target", tone: "green", links: [
    { href: "/settings/statuses", label: "Manage Status", icon: "check", desc: "Lead stages, colours, sub-statuses", keywords: "stage pipeline sub status" },
    { href: "/settings/lost-reasons", label: "Lost Reasons", icon: "xCircle", desc: "Why leads are lost or invalid", keywords: "lost reason invalid win loss" },
    { href: "/settings/sources", label: "Manage Source", icon: "link", desc: "Where leads come from", keywords: "channel" },
    { href: "/settings/tags", label: "Tags", icon: "tag", desc: "Labels to group leads", keywords: "label" },
    { href: "/settings/departments", label: "Departments", icon: "building", desc: "Teams that own leads", keywords: "team" },
    { href: "/settings/custom-fields", label: "Custom Fields", icon: "grid", desc: "Extra fields on every lead", keywords: "field column" },
    { href: "/settings/forms", label: "Forms", icon: "files", desc: "Shareable lead capture forms", keywords: "web form link capture" },
    { href: "/admin/allocation", label: "Lead allocation", icon: "refresh", desc: "Auto-assign by source, city, ratio", keywords: "assign round robin distribute city" },
    { href: "/leads/duplicates", label: "Duplicate leads", icon: "layers", desc: "Find and merge same numbers", keywords: "merge same number dedupe" },
    { href: "/admin/alerts", label: "Follow-up alerts", icon: "alert", desc: "Reminders for missed follow-ups", keywords: "reminder missed push whatsapp notification" },
  ] },
  { label: "Sales & store", icon: "rupee", tone: "amber", links: [
    { href: "/settings/quotes", label: "Quotes & Payments", icon: "rupee", desc: "Quote format, GST, Razorpay", keywords: "quotation invoice gst razorpay payment link" },
    { href: "/admin/catalog", label: "Products · Quick replies", icon: "tag", desc: "Product list and saved replies", keywords: "catalog product price quick reply canned" },
    { href: "/store/settings", label: "Store settings", icon: "cart", desc: "Mini-store link and checkout", keywords: "shop store" },
    { href: "/care/settings", label: "Customer care settings", icon: "heart", desc: "Booking, feedback, referrals, portal", keywords: "appointment nps referral portal" },
  ] },
  { label: "WhatsApp", icon: "chat", tone: "green", links: [
    { href: "/admin/numbers", label: "WhatsApp numbers", icon: "phone", desc: "Numbers and who uses them", keywords: "number phone" },
    { href: "/admin/templates", label: "Templates", icon: "template", desc: "Message templates for leads", keywords: "template message" },
    { href: "/admin/integrations", label: "WhatsApp Cloud API", icon: "plug", desc: "Connect Meta Cloud API", keywords: "meta cloud api token waba connect" },
    { href: "/whatsapp/settings", label: "WhatsApp settings", icon: "gear", desc: "Preferences, agents, canned replies", keywords: "preferences agents canned replies diagnostics" },
  ] },
  { label: "Integrations", icon: "link", tone: "violet", links: [
    { href: "/admin/lead-sources", label: "Lead sources", icon: "globe", desc: "Google Ads, IndiaMART, JustDial, widget", keywords: "google ads indiamart justdial website chat widget zapier pabbly webhook sync" },
    { href: "/admin/fb-login", label: "Facebook Lead Ads", icon: "facebook", desc: "Pull leads from Facebook forms", keywords: "meta facebook instant form", feature: "fb_leads" },
    { href: "/admin/api", label: "API & webhooks", icon: "code", desc: "API keys and outgoing webhooks", keywords: "api key rest developer zapier webhook integration software" },
  ] },
];

/** Groups with links the company's plan allows (empty groups dropped). */
export function settingsGroups(features: string[]): SettingsGroup[] {
  return SETTINGS_GROUPS
    .map((g) => ({ ...g, links: g.links.filter((l) => !l.feature || features.includes(l.feature)) }))
    .filter((g) => g.links.length);
}

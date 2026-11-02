// Page-wise access for Agents and Team Leaders (Admin → Roles & permissions → Page access).
// Stored in lb_role_page_access; a missing row means full access, so nothing changes until an admin unticks a box.
// Admin-only pages (Manage, Integrations, Platform) are not listed: they stay admin-only.

export type PageAction = "view" | "edit" | "delete";
export type PageAccess = Record<string, { view: boolean; edit: boolean; delete: boolean }>;

export const PAGES: { key: string; label: string; paths: string[]; edit?: string; delete?: string }[] = [
  { key: "lead_reports", label: "Lead Reports & Analytics", paths: ["/lead-reports", "/analytics", "/win-loss", "/report-builder"] },
  { key: "leads", label: "Leads", paths: ["/leads"], edit: "Add / edit leads, custom fields" },
  { key: "followups", label: "Follow-ups", paths: ["/followups"] },
  { key: "calls", label: "Calls", paths: ["/calls"] },
  { key: "leaderboard", label: "Leaderboard", paths: ["/leaderboard"] },
  { key: "customers", label: "Customers 360", paths: ["/customers"] },
  { key: "tasks", label: "Tasks", paths: ["/tasks"], edit: "Create / update tasks", delete: "Delete tasks" },
  { key: "field", label: "Field Force", paths: ["/field"] },
  { key: "inbox", label: "Inbox & live chat", paths: ["/inbox", "/whatsapp/live-chat", "/whatsapp/contacts"] },
  { key: "whatsapp", label: "WhatsApp (overview, templates, send, campaigns)", paths: ["/whatsapp"] },
  { key: "automation", label: "Chatbots & flows", paths: ["/whatsapp/chatbots", "/whatsapp/flows"] },
  { key: "documents", label: "Documents", paths: ["/documents"], edit: "Upload / edit documents", delete: "Delete documents" },
  { key: "store", label: "Store orders", paths: ["/store"], edit: "Update orders" },
  { key: "quotes", label: "Quotes & Invoices", paths: ["/quotes"], edit: "Create / edit quotes, payment links", delete: "Delete quotes" },
  { key: "care", label: "Customer care", paths: ["/care"], edit: "Book appointments, referrals" },
  { key: "marketing", label: "Marketing (nurture)", paths: ["/nurture"] },
  { key: "reports", label: "360 Reports", paths: ["/reports"] },
];

/** Page key for a URL path (longest matching prefix wins), or null when the path is not configurable. */
export function pageForPath(path: string): string | null {
  let best: { key: string; len: number } | null = null;
  for (const p of PAGES) for (const prefix of p.paths) {
    if ((path === prefix || path.startsWith(prefix + "/")) && (!best || prefix.length > best.len)) best = { key: p.key, len: prefix.length };
  }
  // Admin-only screens that live under a configurable prefix keep their own admin checks.
  if (path.startsWith("/leads/duplicates")) return null;
  return best?.key ?? null;
}

export function allowed(access: PageAccess, page: string, action: PageAction = "view") {
  const a = access[page];
  return !a || a[action] !== false;
}

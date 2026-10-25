"use client";
import Link from "next/link";
import { useState } from "react";
import { WA_TABS } from "@/app/(app)/whatsapp/tabs";
import { Icon } from "./kit";
import { WA_API_SETUP, WA_GETTING_STARTED, WA_NUMBER_CHECKLIST } from "./guides";

// Help & Guides drawer. Content is the setup steps and page descriptions the app already shows, gathered in one place.

const GUIDE_CATS = ["Getting Started", "Sales", "Inbox", "Marketing", "Automation"] as const;
type GuideCat = (typeof GUIDE_CATS)[number];
type Guide = { title: string; sub: string; href: string; icon: string; cat: GuideCat; steps?: React.ReactNode[] };

const wa = (href: string, cat: GuideCat): Guide => {
  const t = WA_TABS.find((x) => x.href === href)!;
  return { title: `WhatsApp · ${t.label}`, sub: t.sub, href, icon: t.icon, cat };
};

const GUIDES: Guide[] = [
  // Step-by-step setup guides
  { cat: "Getting Started", icon: "check", href: "/whatsapp", title: "WhatsApp getting started", sub: "Five steps from a new account to automated replies.",
    steps: WA_GETTING_STARTED.map(([t, s, href]) => <><Link className="font-semibold text-brand-700 hover:underline" href={href}>{t}</Link>: {s}</>) },
  { cat: "Getting Started", icon: "link", href: "/admin/integrations", title: "Connect the WhatsApp Cloud API", sub: "Everything needed to connect LEAD BOX to the official WhatsApp Business Platform (Cloud API).", steps: WA_API_SETUP },
  { cat: "Getting Started", icon: "plug", href: "/whatsapp/connections", title: "Connect a WhatsApp number", sub: "Connect WhatsApp Business numbers (Cloud API) and check their health", steps: WA_NUMBER_CHECKLIST },
  { cat: "Getting Started", icon: "facebook", href: "/admin/fb-login", title: "Facebook Lead Ads", sub: "Connect the Facebook account that manages your Pages and Lead Ads. New leads will be created in LEAD BOX automatically. Needs the Meta App ID and App Secret in Integrations." },
  { cat: "Getting Started", icon: "contacts", href: "/admin/users", title: "Users", sub: "Create users, set role, placement, scoped permissions and allocation limits." },
  { cat: "Getting Started", icon: "shield", href: "/admin/roles", title: "Roles & permissions", sub: "Choose what Agents and Team Leaders can do. Enforced by the database on every action, not just hidden buttons. Data visibility stays role-based: agents see their own leads and chats, team leaders their permitted teams, admins the whole company." },
  { cat: "Getting Started", icon: "building", href: "/admin/org", title: "Organisation", sub: "Company → Branch → Department → Team → Users. Deactivate instead of deleting to keep history." },
  { cat: "Getting Started", icon: "clock", href: "/admin/audit", title: "Audit log", sub: "Admin and sensitive actions. Lead status/assignment history is on each lead." },
  // Sales
  { cat: "Sales", icon: "plus", href: "/leads/new", title: "New lead", sub: "Phone numbers are normalised and checked for duplicates within your company." },
  { cat: "Sales", icon: "upload", href: "/import", title: "Import leads (CSV)", sub: "Map columns, preview validation and duplicates, then import. Product, source, branch, department and tags are matched by name; owner by email." },
  { cat: "Sales", icon: "calendar", href: "/followups", title: "Follow-ups", sub: "Times shown in IST. Reminders arrive as in-app notifications 15 minutes before due." },
  { cat: "Sales", icon: "user", href: "/customers", title: "Customer 360", sub: "Every customer you can access. Open one to see chats, leads, notes, follow-ups and the full timeline." },
  { cat: "Sales", icon: "list", href: "/admin/statuses", title: "Lead statuses", sub: "Sales statuses (separate from chat Open/Pending/Resolved). Each maps to a stable reporting category so reports survive renames." },
  { cat: "Sales", icon: "refresh", href: "/admin/allocation", title: "Allocation rules", sub: "New unassigned leads are matched to the first active rule (lowest priority number) whose conditions all match, then given round-robin to its eligible users: active, opted into auto-allocation, and under their open-lead limit." },
  // Inbox
  wa("/whatsapp/live-chat", "Inbox"), wa("/whatsapp/contacts", "Inbox"), wa("/whatsapp/send", "Inbox"), wa("/whatsapp/templates", "Inbox"),
  { cat: "Inbox", icon: "template", href: "/admin/templates", title: "Message templates", sub: "Submit new templates to Meta here, or create them in WhatsApp Manager and sync. Only APPROVED templates can be sent; MARKETING templates are blocked for opted-out customers." },
  { cat: "Inbox", icon: "phone", href: "/admin/numbers", title: "WhatsApp Business numbers", sub: "Official WhatsApp Business Platform (Cloud API). Tokens are verified with Meta, encrypted, and never sent to the browser." },
  // Marketing
  { cat: "Marketing", icon: "megaphone", href: "/nurture/campaigns", title: "Campaigns", sub: "One-off sends of an approved template to a segment. Draft → approval → scheduled send." },
  wa("/whatsapp/campaigns", "Marketing"),
  { cat: "Marketing", icon: "layers", href: "/nurture/segments", title: "Customer segments", sub: "Reusable audiences for campaigns and segment-triggered journeys. Counts are live; consent and suppression are applied again right before each send." },
  { cat: "Marketing", icon: "gift", href: "/nurture/offers", title: "Offers", sub: "Offers must be approved and inside their validity window at the moment of sending — otherwise the journey step or campaign message is held. Editing an offer sends it back for approval." },
  { cat: "Marketing", icon: "shield", href: "/nurture/consent", title: "Consent & suppression", sub: "Automated journeys and campaigns only message customers with a recorded WhatsApp opt-in. STOP/UNSUBSCRIBE replies opt customers out automatically and START opts them back in. Suppressed numbers are never messaged by automation." },
  { cat: "Marketing", icon: "chart", href: "/nurture/performance", title: "Journey & campaign performance", sub: "A reply is credited to the most recent automated message to that customer within 7 days; a conversion (Won) and its won value to the most recent delivered automated message within 30 days. Each lead's conversion is credited once." },
  wa("/whatsapp/commerce", "Marketing"),
  // Automation
  wa("/whatsapp/chatbots", "Automation"), wa("/whatsapp/flows", "Automation"),
  { cat: "Automation", icon: "flow", href: "/nurture/journeys", title: "Nurturing journeys", sub: "Automated sequences of approved-template messages, agent tasks, waits and branches. One running journey per lead; lower priority number wins conflicts. Drafts never run: preview and publish to create a version. Eligibility, consent, caps and quiet hours are rechecked before every send." },
  { cat: "Automation", icon: "pulse", href: "/nurture/logs", title: "Execution log", sub: "Every journey step, deferral, retry and stop, newest first. Deferred = held by consent, cap, quiet hours or a pause; it runs later automatically." },
  { cat: "Automation", icon: "book", href: "/nurture/knowledge", title: "AI knowledge", sub: "Suggested replies may only use APPROVED entries (prices, policies, product facts). Editing an entry returns it to draft until re-approved." },
];

const ICON: Record<GuideCat | "All", string> = { All: "grid", "Getting Started": "sparkle", Sales: "target", Inbox: "inbox", Marketing: "megaphone", Automation: "bot" };

export function HelpDrawer({ allowed, onClose }: { allowed: string[]; onClose: () => void }) {
  const [cat, setCat] = useState<GuideCat | "All">("All");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const t = q.trim().toLowerCase();
  // Only guides for pages this user can open.
  const mine = GUIDES.filter((g) => allowed.some((a) => g.href === a || g.href.startsWith(a + "/")));
  const shown = mine.filter((g) => (cat === "All" || g.cat === cat) && (!t || `${g.title} ${g.sub}`.toLowerCase().includes(t)));
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-navy-950/40" onMouseDown={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <aside role="dialog" aria-label="Help & Guides" className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-200 bg-gradient-to-b from-brand-50 to-white p-4 md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-brand-600 text-white"><Icon name="book" className="h-5 w-5" /></span>
              <div>
                <h2 className="text-lg font-semibold text-navy-900">Help &amp; Guides</h2>
                <p className="text-xs text-slate-500">Setup steps and how each part of LEAD BOX works.</p>
              </div>
            </div>
            <button className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close" onClick={onClose}><Icon name="x" className="h-5 w-5" /></button>
          </div>
          <div className="relative mt-4">
            <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input autoFocus className="input pl-9" placeholder="Search guides: templates, import, chatbots…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
            {(["All", ...GUIDE_CATS] as const).map((c) => (
              <button key={c} onClick={() => setCat(c)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${cat === c ? "border-transparent bg-brand-600 text-white shadow" : "border-slate-200 bg-white text-navy-900 hover:bg-slate-50"}`}>
                <Icon name={ICON[c]} className="h-3.5 w-3.5" />{c === "All" ? "All Guides" : c}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4 md:p-5">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Guides ({shown.length})</div>
          {shown.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No guide matches “{q}”.</p>}
          {shown.map((g) => {
            const isOpen = open === g.href || Boolean(t && g.steps);
            return (
              <div key={g.href} className="rounded-xl border border-slate-200">
                <button className="flex w-full items-start gap-3 p-3 text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : g.href)}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Icon name={g.icon} className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold text-navy-900">{g.title}{g.steps && <span className="badge bg-violet-50 text-violet-700">{g.steps.length} steps</span>}</span>
                    <span className={`block text-xs text-slate-500 ${isOpen ? "" : "line-clamp-2"}`}>{g.sub}</span>
                  </span>
                  <Icon name={isOpen ? "chevronDown" : "chevronRight"} className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 px-3 pb-3 pt-2 text-sm">
                    {g.steps && <ol className="mb-3 list-decimal space-y-1 pl-5 text-slate-700">{g.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
                    <Link href={g.href} onClick={onClose} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">Open page <Icon name="chevronRight" className="h-3.5 w-3.5" /></Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2 border-t border-slate-200 px-4 py-3 text-xs text-slate-500 md:px-5">
          <Icon name="help" className="h-4 w-4" /> Press <kbd className="rounded border border-slate-200 px-1.5 font-mono">?</kbd> anytime to open · <kbd className="rounded border border-slate-200 px-1.5 font-mono">Ctrl K</kbd> to search
        </div>
      </aside>
    </div>
  );
}

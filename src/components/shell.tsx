"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { logout } from "@/lib/actions/auth";
import { setAvailability } from "@/lib/actions/automation";
import { switchCompany } from "@/lib/actions/company-switch";
import { fmtDateTime } from "@/lib/dates";
import { Mascot } from "./mascot";
import { Icon } from "./kit";
import { Logo } from "./logo";
import { HelpDrawer } from "./help-drawer";
import { fmtNum } from "@/lib/wa";
import { clearOfflineData } from "@/lib/offline/queue";

export type NavItem = { href: string; label: string; keywords?: string };
export type NavGroup = { label: string; icon: string; href?: string; items?: NavItem[] };
type User = { id: string; name: string; role: string; company: string; availability: string };
/** Super Admin only: companies they can open from the top bar. */
export type CompanySwitch = { current: string; home: string; companies: { id: string; name: string; active: boolean }[] };
type Notif = { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

const COLLAPSE_KEY = "lb_nav_collapsed";
const leaves = (nav: NavGroup[]) => nav.flatMap((g) => (g.href ? [{ href: g.href, label: g.label, group: "" }] : (g.items ?? []).map((i) => ({ ...i, group: g.label }))));
const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));

export function Shell({ nav, quick, user, wallet, switcher = null, children }: { nav: NavGroup[]; quick: NavItem[]; user: User; wallet: number | null; switcher?: CompanySwitch | null; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState(false);
  const [help, setHelp] = useState(false);
  const [menuQ, setMenuQ] = useState("");
  const groups = nav.filter((g) => g.href || g.items?.length);
  const shownGroups = filterNav(groups, menuQ);
  const all = leaves(groups);
  const fullBleed = path.startsWith("/inbox");
  // Most specific match wins, so /whatsapp/chatbots does not also light up /whatsapp.
  const activeHref = all.filter((n) => path === n.href || path.startsWith(n.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const initial = user.name.trim().charAt(0).toUpperCase() || "?";

  useEffect(() => { try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch {} }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearch((v) => !v); }
      else if (e.key === "?" && !typing(e) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setHelp((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const toggleSidebar = () => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setCollapsed((c) => { try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch {} return !c; });
    } else setOpen(true);
  };

  return (
    <div className="flex h-full">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] transform flex-col bg-navy-900 text-slate-300 transition md:static md:w-60 md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"} ${collapsed ? "md:hidden" : ""}`}>
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 bg-white px-4">
          <Logo className="h-8" />
          <button className="grid h-8 w-8 place-items-center rounded-lg text-navy-900 hover:bg-slate-100 md:hidden" aria-label="Close menu" onClick={() => setOpen(false)}><Icon name="x" className="h-5 w-5" /></button>
        </div>
        <div className="shrink-0 px-3 pt-3">
          <label className="relative block">
            <span className="sr-only">Search menu</span>
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input value={menuQ} onChange={(e) => setMenuQ(e.target.value)} placeholder="Search menu…" autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Escape") setMenuQ("");
                if (e.key === "Enter") { const first = leaves(shownGroups)[0]; if (first) { router.push(first.href); setMenuQ(""); setOpen(false); } }
              }}
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-7 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none" />
            {menuQ && <button type="button" onClick={() => setMenuQ("")} aria-label="Clear menu search" className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-slate-400 hover:text-white"><Icon name="x" className="h-3.5 w-3.5" /></button>}
          </label>
        </div>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-3" aria-label="Main">
          {shownGroups.map((g) => <NavGroupLink key={g.label} group={g} activeHref={activeHref} forceOpen={menuQ.trim() !== ""} onNavigate={() => { setOpen(false); setMenuQ(""); }} />)}
          {shownGroups.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">No menu item matches “{menuQ}”.</p>}
        </nav>
        <div className="shrink-0 border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">{initial}</span>
            <div className="min-w-0 flex-1 text-xs">
              <div className="truncate text-sm font-semibold text-white">{user.name}</div>
              <div className="truncate text-slate-400">{user.role} · {user.company}</div>
            </div>
            <form action={logout} onSubmit={() => { void clearOfflineData(); }}><button className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white" title="Sign out" aria-label="Sign out"><Icon name="logout" className="h-4 w-4" /></button></form>
          </div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-navy-950/50 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 md:px-4">
          <button className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-navy-900 hover:bg-slate-100" aria-label="Toggle menu" title="Toggle menu" onClick={toggleSidebar}>
            <Icon name="sidebar" className="h-5 w-5 max-md:hidden" /><Icon name="menu" className="h-5 w-5 md:hidden" />
          </button>
          <button onClick={() => setSearch(true)} aria-label="Search (Ctrl+K)"
            className="flex h-9 shrink-0 items-center gap-2 rounded-lg border-slate-200 text-sm text-slate-400 hover:border-slate-300 max-md:w-9 max-md:justify-center max-md:text-navy-900 max-md:hover:bg-slate-100 md:w-64 md:border md:bg-slate-50 md:px-3">
            <Icon name="search" className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate text-left max-md:hidden">Search pages, leads…</span>
            <kbd className="rounded border border-slate-200 bg-white px-1.5 font-mono text-[10px] text-slate-500 max-md:hidden">Ctrl K</kbd>
          </button>
          {quick.length > 0 && <QuickCreate items={quick} />}
          {switcher && <CompanySwitcher data={switcher} />}
          <span className="ml-auto flex items-center gap-1.5 md:gap-2">
            <button onClick={() => setHelp(true)} aria-label="Help & Guides (?)" title="Help & Guides (?)"
              className="flex h-9 items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 text-sm font-semibold text-violet-700 hover:bg-violet-100 max-md:w-9 max-md:justify-center md:px-3">
              <Icon name="book" className="h-4 w-4" /><span className="max-md:hidden">Help &amp; Guides</span>
              <kbd className="rounded border border-violet-200 bg-white px-1 font-mono text-[10px] max-md:hidden">?</kbd>
            </button>
            {wallet !== null && (
              <Link href="/wallet" title="Wallet balance · add balance by UPI" aria-label={`Wallet ₹${fmtNum(wallet)}`}
                className="flex h-9 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100">
                <Icon name="wallet" className="h-4 w-4" /><span className="max-sm:hidden">₹{fmtNum(wallet)}</span>
              </Link>
            )}
            <Bell userId={user.id} />
            <Profile user={user} initial={initial} />
          </span>
        </header>
        <main className={`min-h-0 flex-1 ${fullBleed ? "overflow-hidden" : "overflow-auto p-4 md:p-6"}`}>{children}</main>
        {!fullBleed && <Mascot name={user.name} />}
      </div>
      {search && <SearchPalette items={all} onClose={() => setSearch(false)} />}
      {help && <HelpDrawer allowed={[...all.map((n) => n.href), ...quick.map((q) => q.href)]} onClose={() => setHelp(false)} />}
    </div>
  );
}

/** Menu search: a group whose name matches keeps all its items; otherwise only matching items stay. */
function filterNav(groups: NavGroup[], q: string): NavGroup[] {
  const t = q.trim().toLowerCase();
  if (!t) return groups;
  return groups.flatMap((g) => {
    if (g.label.toLowerCase().includes(t)) return [g];
    if (g.href) return [];
    const items = (g.items ?? []).filter((i) => `${i.label} ${i.keywords ?? ""}`.toLowerCase().includes(t));
    return items.length ? [{ ...g, items }] : [];
  });
}

function NavGroupLink({ group: g, activeHref, onNavigate, forceOpen = false }: { group: NavGroup; activeHref?: string; onNavigate: () => void; forceOpen?: boolean }) {
  const hasActive = Boolean(g.items?.some((i) => i.href === activeHref));
  const [manualOpen, setOpen] = useState(hasActive);
  const open = forceOpen || manualOpen;
  useEffect(() => { if (hasActive) setOpen(true); }, [hasActive]);
  const row = (active: boolean) => `relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active ? "bg-white/10 font-semibold text-white" : "hover:bg-white/5 hover:text-white"}`;
  if (g.href) {
    const active = g.href === activeHref;
    return (
      <Link href={g.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={row(active)}>
        {active && <span className="absolute inset-y-1.5 left-0 w-1 rounded-r bg-brand-500" />}
        <Icon name={g.icon} className={`h-4 w-4 shrink-0 ${active ? "text-brand-400" : "text-slate-400"}`} />
        <span className="truncate">{g.label}</span>
      </Link>
    );
  }
  return (
    <div>
      <button className={row(false)} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={g.icon} className={`h-4 w-4 shrink-0 ${hasActive ? "text-brand-400" : "text-slate-400"}`} />
        <span className={`flex-1 truncate text-left ${hasActive ? "font-semibold text-white" : ""}`}>{g.label}</span>
        <Icon name={open ? "chevronDown" : "chevronRight"} className="h-4 w-4 shrink-0 text-slate-500" />
      </button>
      {open && (
        <div className="mb-1 ml-5 space-y-0.5 border-l border-white/10 pl-2">
          {g.items!.map((i) => {
            const active = i.href === activeHref;
            return (
              <Link key={i.href} href={i.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
                className={`relative block truncate rounded-md px-3 py-1.5 text-[13px] transition ${active ? "bg-white/10 font-semibold text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>
                {active && <span className="absolute inset-y-1 -left-2.5 w-0.5 rounded bg-brand-500" />}
                {i.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  return ref;
}

function QuickCreate({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, useCallback(() => setOpen(false), []));
  return (
    <div ref={ref} className="relative shrink-0">
      <button className="btn-primary h-9 max-md:w-9 max-md:justify-center max-md:px-0" aria-label="Quick Create" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="plus" className="h-4 w-4" /><span className="max-md:hidden">Quick Create</span>
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {items.map((i) => (
            <Link key={i.href} href={i.href} onClick={() => setOpen(false)} className="block px-3 py-2 text-sm text-navy-900 hover:bg-slate-50">{i.label}</Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CompanySwitcher({ data }: { data: CompanySwitch }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const close = useCallback(() => { setOpen(false); setQ(""); }, []);
  const ref = useOutside(open, close);
  const current = data.companies.find((c) => c.id === data.current);
  const away = data.current !== data.home;
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    // Own company first, then A-Z.
    return data.companies.filter((c) => !t || c.name.toLowerCase().includes(t))
      .sort((a, b) => Number(b.id === data.home) - Number(a.id === data.home) || a.name.localeCompare(b.name));
  }, [q, data]);
  const pick = (id: string) => {
    if (id === data.current) return close();
    setErr("");
    start(async () => {
      const r = await switchCompany(id === data.home ? null : id);
      if (r?.error) setErr(r.error); else close();
    });
  };
  return (
    <div ref={ref} className="relative min-w-0 shrink">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Switch company (now: ${current?.name ?? "—"})`} title="Switch company"
        className={`flex h-9 min-w-0 items-center gap-1.5 rounded-lg border text-sm font-semibold max-md:w-9 max-md:shrink-0 max-md:justify-center md:max-w-[15rem] md:px-2.5 ${away ? "border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100" : "border-slate-200 bg-white text-navy-900 hover:bg-slate-50"}`}>
        <Icon name="building" className="h-4 w-4 shrink-0" />
        <span className="truncate max-md:hidden">{pending ? "Switching…" : current?.name ?? "Company"}</span>
        <Icon name="chevronDown" className="h-4 w-4 shrink-0 opacity-60 max-md:hidden" />
      </button>
      {open && (
        <div className="z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg max-md:fixed max-md:inset-x-2 max-md:top-14 md:absolute md:left-0 md:mt-2 md:w-80">
          <div className="border-b border-slate-100 p-2">
            <div className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Switch company · Super Admin</div>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${data.companies.length} companies…`}
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-brand-500 focus:bg-white" />
          </div>
          {err && <div className="border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
          <div className="max-h-80 overflow-y-auto py-1">
            {list.map((c) => (
              <button key={c.id} disabled={pending} onClick={() => pick(c.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-60 ${c.id === data.current ? "font-semibold text-navy-900" : "text-slate-700"}`}>
                <span className="grid h-4 w-4 shrink-0 place-items-center">{c.id === data.current && <Icon name="check" className="h-4 w-4 text-brand-600" />}</span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.id === data.home && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">YOURS</span>}
                {!c.active && <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">INACTIVE</span>}
              </button>
            ))}
            {list.length === 0 && <div className="px-3 py-4 text-center text-sm text-slate-400">No company matches “{q}”.</div>}
          </div>
          {away && (
            <button disabled={pending} onClick={() => pick(data.home)} className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-60">
              <Icon name="chevronLeft" className="h-4 w-4" />Back to my company
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "Back to my company" link for the Super Admin banner. */
export function BackHome({ className }: { className?: string }) {
  const [pending, start] = useTransition();
  return (
    <button className={className} disabled={pending} onClick={() => start(async () => { await switchCompany(null); })}>
      {pending ? "Switching…" : "Back to my company"}
    </button>
  );
}

function Profile({ user, initial }: { user: User; initial: string }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, useCallback(() => setOpen(false), []));
  return (
    <div ref={ref} className="relative">
      <button className="grid h-9 w-9 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white" aria-label="Profile" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{initial}</button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <div className="text-sm font-semibold text-navy-900">{user.name}</div>
          <div className="mb-3 text-xs text-slate-500">{user.role} · {user.company}</div>
          <Availability value={user.availability} />
          <form action={logout} onSubmit={() => { void clearOfflineData(); }} className="mt-3 border-t border-slate-100 pt-2"><button className="flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700"><Icon name="logout" className="h-4 w-4" />Sign out</button></form>
        </div>
      )}
    </div>
  );
}

function SearchPalette({ items, onClose }: { items: (NavItem & { group: string })[]; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const t = q.trim().toLowerCase();
  const pages = items.filter((i) => !t || `${i.group} ${i.label}`.toLowerCase().includes(t));
  const results = [...(t ? [{ href: `/leads?q=${encodeURIComponent(q.trim())}`, label: `Search leads for “${q.trim()}”`, group: "Leads" }] : []), ...pages];
  const go = (href: string) => { onClose(); router.push(href); };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-navy-950/40 p-4 pt-[10vh]" onMouseDown={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-3">
          <Icon name="search" className="h-4 w-4 text-slate-400" />
          <input autoFocus className="h-12 flex-1 bg-transparent text-sm text-navy-900 outline-none" placeholder="Search pages, or leads by name / phone / LB-123" value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === "Enter" && results[sel]) go(results[sel].href);
            }} />
          <kbd className="rounded border border-slate-200 px-1.5 font-mono text-[10px] text-slate-500">Esc</kbd>
        </div>
        <ul className="max-h-80 overflow-auto py-1">
          {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No matching pages</li>}
          {results.map((r, i) => (
            <li key={r.href}>
              <button className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${i === sel ? "bg-brand-50 text-brand-700" : "text-navy-900"}`}
                onMouseEnter={() => setSel(i)} onClick={() => go(r.href)}>
                <span className="truncate">{r.label}</span>{r.group && <span className="shrink-0 text-xs text-slate-400">{r.group}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Bell({ userId }: { userId: string }) {
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(false);
  const router = useRouter();
  const load = useCallback(async () => {
    const { data, error } = await getBrowserClient().from("lb_notifications")
      .select("id,title,body,link,read_at,created_at").order("created_at", { ascending: false }).limit(20);
    setErr(Boolean(error));
    if (data) setItems(data);
  }, []);
  useEffect(() => {
    load();
    const sb = getBrowserClient();
    const ch = sb.channel(`notif-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "lb_notifications", filter: `user_id=eq.${userId}` }, () => load())
      .subscribe((s: string) => { if (s === "SUBSCRIBED") load(); }); // refetch on (re)connect
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { sb.removeChannel(ch); window.removeEventListener("focus", onFocus); };
  }, [load, userId]);
  const unread = items.filter((i) => !i.read_at).length;
  const markAll = async () => {
    const ids = items.filter((i) => !i.read_at).map((i) => i.id);
    if (ids.length) await getBrowserClient().from("lb_notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    load();
  };
  return (
    <div className="relative">
      <button className="relative rounded-full p-2 text-navy-900 hover:bg-slate-100" aria-label={`Notifications (${unread} unread)`} onClick={() => setOpen((o) => !o)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2.5 text-sm font-semibold text-navy-900">
            Notifications {unread > 0 && <button className="text-xs text-brand-700" onClick={markAll}>Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-auto">
            {err && <div className="p-3 text-xs text-red-600">Could not load notifications.</div>}
            {!err && items.length === 0 && <div className="p-4 text-center text-sm text-slate-500">No notifications</div>}
            {items.map((n) => (
              <button key={n.id} className={`block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50 ${n.read_at ? "" : "bg-brand-50"}`}
                onClick={async () => {
                  if (!n.read_at) await getBrowserClient().from("lb_notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
                  setOpen(false);
                  load();
                  if (n.link) router.push(n.link);
                }}>
                <div className="font-medium text-navy-900">{n.title}</div>
                {n.body && <div className="truncate text-xs text-slate-600">{n.body}</div>}
                <div className="text-[11px] text-slate-400">{fmtDateTime(n.created_at)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Availability({ value }: { value: string }) {
  const [v, setV] = useState(value);
  const router = useRouter();
  const color = v === "available" ? "bg-brand-500" : v === "away" ? "bg-amber-500" : "bg-slate-400";
  return (
    <label className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-navy-900" title="Your availability for smart allocation and SLA routing">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <select className="bg-transparent outline-none" value={v} aria-label="Availability"
        onChange={async (e) => { const n = e.target.value as "available" | "away" | "offline"; setV(n); const r = await setAvailability(n); if (r.error) { setV(value); alert(r.error); } else router.refresh(); }}>
        <option value="available">Available</option><option value="away">Away</option><option value="offline">Offline</option>
      </select>
    </label>
  );
}

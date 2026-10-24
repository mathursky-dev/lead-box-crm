"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { logout } from "@/lib/actions/auth";
import { setAvailability } from "@/lib/actions/automation";
import { fmtDateTime } from "@/lib/dates";
import { Mascot } from "./mascot";
import { Icon } from "./kit";
import { Logo } from "./logo";

// Sidebar icon per route; unknown routes fall back to a neutral dot.
const NAV_ICON: Record<string, string> = {
  "/dashboard": "grid", "/inbox": "inbox", "/whatsapp": "chat", "/leads": "target", "/followups": "calendar", "/nurture": "refresh",
  "/customers": "user", "/reports": "chart", "/import": "upload", "/admin/quick-setup": "bolt", "/admin": "shield",
};

type Nav = { href: string; label: string };
type User = { id: string; name: string; role: string; company: string; availability: string };
type Notif = { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

export function Shell({ nav, user, children }: { nav: Nav[]; user: User; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const fullBleed = path.startsWith("/inbox");
  // Most specific match wins, so /admin/quick-setup does not also light up /admin.
  const activeHref = nav.filter((n) => path === n.href || path.startsWith(n.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const initial = user.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="flex h-full">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col bg-navy-900 text-slate-300 transition md:static md:w-60 md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-14 shrink-0 items-center bg-white px-4">
          <Logo className="h-8" />
        </div>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {nav.map((n) => {
            const active = n.href === activeHref;
            return (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active ? "bg-white/10 font-semibold text-white" : "hover:bg-white/5 hover:text-white"}`}>
                {active && <span className="absolute inset-y-1.5 left-0 w-1 rounded-r bg-brand-500" />}
                <Icon name={NAV_ICON[n.href] ?? "chat"} className={`h-4 w-4 shrink-0 ${active ? "text-brand-400" : "text-slate-400"}`} />
                <span className="truncate">{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="shrink-0 border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">{initial}</span>
            <div className="min-w-0 text-xs">
              <div className="truncate font-semibold text-white">{user.name}</div>
              <div className="truncate text-slate-400">{user.role} · {user.company}</div>
            </div>
          </div>
          <form action={logout} className="mt-2"><button className="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-brand-400 hover:text-brand-100"><Icon name="logout" className="h-3.5 w-3.5" />Sign out</button></form>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-navy-950/50 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4">
          <button className="grid h-9 w-9 place-items-center rounded-lg text-navy-900 hover:bg-slate-100 md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Icon name="menu" className="h-5 w-5" /></button>
          <div className="flex items-center gap-2 text-sm font-semibold text-navy-900 max-md:hidden"><Icon name="building" className="h-4 w-4 text-slate-400" />{user.company}</div>
          <span className="flex items-center gap-2"><Availability value={user.availability} /><Bell userId={user.id} /></span>
        </header>
        <main className={`min-h-0 flex-1 ${fullBleed ? "overflow-hidden" : "overflow-auto p-4 md:p-6"}`}>{children}</main>
        {!fullBleed && <Mascot name={user.name} />}
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

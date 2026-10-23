"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { logout } from "@/lib/actions/auth";
import { setAvailability } from "@/lib/actions/automation";
import { fmtDateTime } from "@/lib/dates";
import { Mascot } from "./mascot";

type Nav = { href: string; label: string };
type User = { id: string; name: string; role: string; company: string; availability: string };
type Notif = { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

export function Shell({ nav, user, children }: { nav: Nav[]; user: User; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const fullBleed = path.startsWith("/inbox");
  return (
    <div className="flex h-full">
      <aside className={`fixed inset-y-0 left-0 z-40 w-56 transform bg-navy-900 text-slate-200 transition md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-14 items-center bg-white px-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <span className="lb-logo"><img src="/leadbox-wordmark.svg" alt="leadbox" width={849} height={179} className="block h-7 w-auto" /></span>
        </div>
        <nav className="space-y-0.5 px-2">
          {nav.map((n) => {
            const active = path === n.href || path.startsWith(n.href + "/");
            return (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
                className={`block rounded-md px-3 py-2 text-sm ${active ? "bg-navy-700 font-medium text-white" : "hover:bg-navy-800"}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-navy-800 p-3 text-xs">
          <div className="truncate font-medium text-white">{user.name}</div>
          <div className="truncate text-slate-400">{user.role} · {user.company}</div>
          <form action={logout} className="mt-2"><button className="text-brand-500 hover:underline">Sign out</button></form>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
          <button className="rounded p-1 text-navy-900 md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>☰</button>
          <div className="text-sm font-medium text-slate-500 max-md:hidden">{user.company}</div>
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
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
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
    <label className="flex items-center gap-1.5 rounded-full border border-slate-200 px-2 py-1 text-xs" title="Your availability for smart allocation and SLA routing">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <select className="bg-transparent outline-none" value={v} aria-label="Availability"
        onChange={async (e) => { const n = e.target.value as "available" | "away" | "offline"; setV(n); const r = await setAvailability(n); if (r.error) { setV(value); alert(r.error); } else router.refresh(); }}>
        <option value="available">Available</option><option value="away">Away</option><option value="offline">Offline</option>
      </select>
    </label>
  );
}

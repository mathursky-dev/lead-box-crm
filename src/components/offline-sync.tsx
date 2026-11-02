"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./kit";
import { QUEUE_EVENT, flushQueue, listQueue } from "@/lib/offline/queue";

const WARM_KEY = "lb_sw_warm";
const WARM_EVERY = 6 * 3600e3;

/**
 * Offline mode, mounted once in the app layout:
 * - registers the service worker and (every few hours) asks it to keep the Field app on the phone;
 * - sends entries saved offline as soon as the network is back (and every minute while some wait);
 * - shows a small bar while offline, or while entries are waiting.
 */
export function OfflineSync({ userId }: { userId: string }) {
  const path = usePathname();
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    (async () => {
      try {
        const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
        let last = 0;
        try { last = Number(localStorage.getItem(WARM_KEY)) || 0; } catch { /* private mode */ }
        if (navigator.onLine && Date.now() - last > WARM_EVERY) {
          await navigator.serviceWorker.ready;
          (reg.active ?? navigator.serviceWorker.controller)?.postMessage({ type: "warm" });
          try { localStorage.setItem(WARM_KEY, String(Date.now())); } catch { /* ignore */ }
        }
      } catch { /* unsupported WebView: offline mode is simply off */ }
    })();
  }, []);

  useEffect(() => {
    let stop = false;
    const count = async () => {
      try { const q = await listQueue(userId); if (!stop) setWaiting(q.filter((e) => !e.error).length); } catch { /* no IndexedDB */ }
    };
    const send = async () => {
      if (!navigator.onLine) return;
      const q = await listQueue(userId).catch(() => []);
      if (!q.some((e) => !e.error)) return;
      const r = await flushQueue(userId);
      await count();
      if (r.sent) router.refresh();
    };
    const on = () => { setOnline(navigator.onLine); if (navigator.onLine) void send(); };
    on(); void count();
    window.addEventListener("online", on); window.addEventListener("offline", on);
    window.addEventListener(QUEUE_EVENT, count);
    const t = window.setInterval(send, 60000);
    return () => { stop = true; window.removeEventListener("online", on); window.removeEventListener("offline", on); window.removeEventListener(QUEUE_EVENT, count); window.clearInterval(t); };
  }, [userId, router]);

  if (path === "/field" || (online && waiting === 0)) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center p-2 sm:p-3" role="status">
      <div className={`flex max-w-xl flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-2 text-xs shadow-lg sm:text-sm ${online ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "bg-navy-900 text-white"}`}>
        <Icon name={online ? "upload" : "wifiOff"} className="h-4 w-4 shrink-0" />
        <span>{online ? `${waiting} offline entr${waiting === 1 ? "y is" : "ies are"} being sent…` : `You are offline.${waiting ? ` ${waiting} entr${waiting === 1 ? "y" : "ies"} saved on this phone.` : ""} Check-ins, visits, expenses, leads and notes still work in the Field app.`}</span>
        <Link href="/field" className="font-semibold underline">Open Field app</Link>
      </div>
    </div>
  );
}

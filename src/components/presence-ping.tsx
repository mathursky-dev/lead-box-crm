"use client";
import { useEffect } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

const EVERY = 2 * 60e3;

/**
 * Daily login time: tells the server "this user has the CRM open" every 2 minutes while the
 * tab is visible (lb_presence_ping). The server keeps first seen / last seen / active time per
 * IST day in lb_user_days; sign-in and sign-out come from the login log. Never shows anything.
 */
export function PresencePing() {
  useEffect(() => {
    let last = 0;
    const ping = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 50e3) return;
      last = Date.now();
      void getBrowserClient().rpc("lb_presence_ping").then(() => undefined, () => undefined);
    };
    ping();
    const t = window.setInterval(ping, EVERY);
    document.addEventListener("visibilitychange", ping);
    window.addEventListener("focus", ping);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", ping); window.removeEventListener("focus", ping); };
  }, []);
  return null;
}

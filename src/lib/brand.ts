import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "./supabase/server";

/** A reseller's white-label look (lb_brands). Null everywhere means the normal Lead Box look. */
export type Brand = {
  id: string; name: string; logo_url: string | null; icon_url: string | null;
  primary_color: string; sidebar_color: string; tagline: string | null;
  support_email: string | null; support_phone: string | null; website: string | null;
  hide_powered_by: boolean; domain?: string | null; is_owner?: boolean;
};

/** Hosts that always show the Lead Box look, so no lookup is needed on them. */
function isHomeHost(host: string) {
  let app = "";
  try { app = new URL(process.env.APP_URL ?? "").hostname; } catch { /* none */ }
  return !host || host === app || host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app")
    || host === "leadboxs.in" || host.endsWith(".leadboxs.in");
}

export const requestHost = cache(async () => {
  const h = await headers();
  return (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim().toLowerCase().split(":")[0];
});

/** Brand of the custom domain this request came in on (login page, public pages). */
export const getHostBrand = cache(async (): Promise<Brand | null> => {
  const host = await requestHost();
  if (isHomeHost(host)) return null;
  try {
    const sb = await createClient();
    const { data } = await sb.rpc("lb_brand_for_host", { p_host: host });
    return (data as Brand | null) ?? null;
  } catch {
    return null;
  }
});

/** Brand for a signed-in user: their company's brand (or the brand it owns), else the domain's brand. */
export const getUserBrand = cache(async (): Promise<Brand | null> => {
  try {
    const sb = await createClient();
    const { data } = await sb.rpc("lb_my_brand");
    if (data) return data as Brand;
  } catch { /* fall through */ }
  return getHostBrand();
});

// ---------------------------------------------------------------- colours
const HEX = /^#[0-9a-f]{6}$/i;
function mix(hex: string, to: number, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (to - c) * amount));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** CSS that swaps the theme colours (Tailwind @theme variables) for the brand's. Empty when no brand. */
export function brandCss(b: Brand | null) {
  if (!b) return "";
  const vars: string[] = [];
  if (HEX.test(b.primary_color)) {
    const p = b.primary_color;
    vars.push(`--color-brand-50:${mix(p, 255, 0.92)}`, `--color-brand-100:${mix(p, 255, 0.82)}`, `--color-brand-400:${mix(p, 255, 0.3)}`,
      `--color-brand-500:${mix(p, 255, 0.12)}`, `--color-brand-600:${p}`, `--color-brand-700:${mix(p, 0, 0.18)}`);
  }
  if (HEX.test(b.sidebar_color)) {
    const s = b.sidebar_color;
    vars.push(`--color-navy-950:${mix(s, 0, 0.3)}`, `--color-navy-900:${s}`, `--color-navy-800:${mix(s, 255, 0.1)}`, `--color-navy-700:${mix(s, 255, 0.2)}`);
  }
  return vars.length ? `:root{${vars.join(";")}}` : "";
}

/** The part of a brand the browser needs (logo + name), safe to pass to client components. */
export const brandLogo = (b: Brand | null) => (b ? { name: b.name, logo_url: b.logo_url, tagline: b.tagline } : null);

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { brandCss, getHostBrand } from "@/lib/brand";

// On a white-label partner's own domain the tab title, icon and colours are the partner's.
export async function generateMetadata(): Promise<Metadata> {
  const b = await getHostBrand();
  const name = b?.name ?? "LEAD BOX";
  const appName = b?.name ?? "Lead Box";
  return {
    title: { default: name, template: `%s · ${name}` },
    description: b?.tagline ?? "WhatsApp CRM",
    applicationName: appName,
    icons: b?.icon_url ? { icon: b.icon_url, apple: b.icon_url } : { icon: "/icons/icon-192.png", apple: "/icons/apple-icon.png" },
    // iPhone "Add to Home Screen" opens full screen like an app.
    appleWebApp: { capable: true, title: appName, statusBarStyle: "black-translucent" },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const b = await getHostBrand();
  return { width: "device-width", initialScale: 1, themeColor: b?.sidebar_color ?? "#0b1f3a" };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const css = brandCss(await getHostBrand());
  return (
    <html lang="en">
      {css && <head><style id="lb-host-brand" dangerouslySetInnerHTML={{ __html: css }} /></head>}
      <body className="antialiased">{children}</body>
    </html>
  );
}

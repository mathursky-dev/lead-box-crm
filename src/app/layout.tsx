import type { Metadata, Viewport } from "next";
import "./globals.css";
import { brandCss, getHostBrand } from "@/lib/brand";

// On a white-label partner's own domain the tab title, icon and colours are the partner's.
export async function generateMetadata(): Promise<Metadata> {
  const b = await getHostBrand();
  const name = b?.name ?? "LEAD BOX";
  return {
    title: { default: name, template: `%s · ${name}` },
    description: b?.tagline ?? "WhatsApp CRM",
    ...(b?.icon_url ? { icons: { icon: b.icon_url } } : {}),
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

import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LEAD BOX", template: "%s · LEAD BOX" },
  description: "WhatsApp CRM",
  applicationName: "Lead Box",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-icon.png" },
  appleWebApp: { capable: true, title: "Lead Box", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b1f3a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

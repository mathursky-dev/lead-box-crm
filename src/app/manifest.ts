import type { MetadataRoute } from "next";

// Web app manifest: makes the CRM installable and is what the Android (Play Store) app wraps.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Lead Box WhatsApp CRM",
    short_name: "Lead Box",
    description: "WhatsApp CRM for leads, chats, follow-ups and team.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b1f3a",
    theme_color: "#0b1f3a",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

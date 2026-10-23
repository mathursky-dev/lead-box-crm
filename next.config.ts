import type { NextConfig } from "next";

// Every page is per-user and RLS-scoped, so the app renders dynamically
// (Cache Components / partial prefetching are intentionally off).
const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: [],
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;

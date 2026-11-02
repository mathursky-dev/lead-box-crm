import { redirect } from "next/navigation";

// Analytics is now the Dashboard; keep old links and bookmarks working.
export default async function AnalyticsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (v) q.set(k, v);
  const s = q.toString();
  redirect(s ? `/dashboard?${s}` : "/dashboard");
}

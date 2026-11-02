import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { testFacebook, type TestResult } from "@/lib/actions/facebook";
import { testConnectorKind } from "@/lib/actions/connectors";
import { TestButton } from "./test-button";

export const metadata = { title: "Quick Setup" };

type Integration = { key: string; title: string; setHref: string; icon: React.ReactNode; status: string; test: () => Promise<TestResult> };

const FbIcon = (
  <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-[#1877F2] text-5xl font-bold text-white" aria-hidden>
    f<span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-600 text-sm">⚙</span>
  </span>
);

export default async function QuickSetupPage() {
  const { profile } = await requireAdmin();
  let fbStatus = "Not connected";
  const connStatus: Record<string, { n: number; live: number; leads: number }> = {};
  if (hasServiceRole()) {
    const db = createAdminClient();
    const [{ data: acct }, { count }] = await Promise.all([
      db.from("lb_fb_accounts").select("fb_user_name").eq("company_id", profile.company_id).maybeSingle(),
      db.from("lb_fb_pages").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id),
    ]);
    if (acct) fbStatus = `Connected as ${acct.fb_user_name ?? "Facebook user"} · ${count ?? 0} page${count === 1 ? "" : "s"}`;
    const { data: conns } = await db.from("lb_lead_connectors").select("kind,is_active,leads_count").eq("company_id", profile.company_id);
    for (const c of conns ?? []) {
      const cur = connStatus[c.kind] ?? { n: 0, live: 0, leads: 0 };
      connStatus[c.kind] = { n: cur.n + 1, live: cur.live + (c.is_active ? 1 : 0), leads: cur.leads + (c.leads_count ?? 0) };
    }
  }
  const st = (k: string) => { const c = connStatus[k]; return c ? `${c.live} of ${c.n} live · ${c.leads} lead${c.leads === 1 ? "" : "s"}` : "Not connected"; };
  const badge = (txt: string, bg: string) => (
    <span className={`flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold text-white ${bg}`} aria-hidden>{txt}</span>
  );

  const integrations: Integration[] = [
    { key: "facebook", title: "Facebook Integration", setHref: "/admin/fb-login", icon: FbIcon, status: fbStatus, test: testFacebook },
    { key: "google", title: "Google Ads Lead Forms", setHref: "/admin/lead-sources?kind=google#google", icon: badge("G", "bg-[#4285F4]"), status: st("google"), test: testConnectorKind.bind(null, "google") },
    { key: "indiamart", title: "IndiaMART", setHref: "/admin/lead-sources?kind=indiamart#indiamart", icon: badge("IM", "bg-[#2E3192]"), status: st("indiamart"), test: testConnectorKind.bind(null, "indiamart") },
    { key: "justdial", title: "JustDial", setHref: "/admin/lead-sources?kind=justdial#justdial", icon: badge("JD", "bg-[#FF6F00]"), status: st("justdial"), test: testConnectorKind.bind(null, "justdial") },
    { key: "widget", title: "Website Chat Widget", setHref: "/admin/lead-sources?kind=widget#widget", icon: badge("💬", "bg-[#25D366]"), status: st("widget"), test: testConnectorKind.bind(null, "widget") },
    { key: "webhook", title: "Other software (Webhook)", setHref: "/admin/lead-sources?kind=webhook#webhook", icon: badge("{ }", "bg-slate-700"), status: st("webhook"), test: testConnectorKind.bind(null, "webhook") },
  ];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm font-semibold text-slate-600"><Link href="/dashboard" aria-label="Home" className="text-violet-700">⌂</Link><span className="text-violet-700">›</span> Quick Setup</nav>
      <h2 className="mb-3 text-lg font-semibold text-navy-900">Integration</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {integrations.map((i) => (
          <div key={i.key} className="relative rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <Link href={i.setHref} className="btn btn-sm rounded-full bg-indigo-700 px-4 text-white hover:bg-indigo-800">Set</Link>
              <TestButton action={i.test} />
            </div>
            <div className="flex flex-col items-center gap-3 py-6">
              {i.icon}
              <div className="text-base font-semibold text-navy-900">{i.title}</div>
              <div className="text-xs text-slate-500">{i.status}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-slate-600">Need your own software to create or read leads? <Link href="/admin/api" className="font-medium text-brand-700 hover:underline">API keys &amp; webhooks</Link> · Bulk upload: <Link href="/import" className="font-medium text-brand-700 hover:underline">Import Excel / CSV</Link></p>
    </>
  );
}

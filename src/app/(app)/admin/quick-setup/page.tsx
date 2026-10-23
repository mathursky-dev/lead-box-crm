import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { PageHeader } from "@/components/static";
import { testFacebook, type TestResult } from "@/lib/actions/facebook";
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
  if (hasServiceRole()) {
    const db = createAdminClient();
    const [{ data: acct }, { count }] = await Promise.all([
      db.from("lb_fb_accounts").select("fb_user_name").eq("company_id", profile.company_id).maybeSingle(),
      db.from("lb_fb_pages").select("id", { count: "exact", head: true }).eq("company_id", profile.company_id),
    ]);
    if (acct) fbStatus = `Connected as ${acct.fb_user_name ?? "Facebook user"} · ${count ?? 0} page${count === 1 ? "" : "s"}`;
  }

  const integrations: Integration[] = [
    { key: "facebook", title: "Facebook Integration", setHref: "/admin/fb-login", icon: FbIcon, status: fbStatus, test: testFacebook },
  ];

  return (
    <>
      <PageHeader title="Quick Setup" />
      <h2 className="mb-3 text-sm font-semibold text-navy-900">Integration</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {integrations.map((i) => (
          <div key={i.key} className="relative rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <Link href={i.setHref} className="btn btn-sm rounded-full bg-violet-600 px-4 text-white hover:bg-violet-700">Set</Link>
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
    </>
  );
}

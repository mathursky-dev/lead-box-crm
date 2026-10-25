import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { UpgradeNotice } from "@/components/upgrade";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { ErrorBox } from "@/components/static";
import { fbAccount } from "@/lib/facebook";
import { graph } from "@/lib/whatsapp";
import { FbHeader, FbPickers, SavedPages, SavedAds } from "./forms";

export const metadata = { title: "FB Login" };

export default async function FbLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { profile, features } = await requireAdmin();
  if (!features.includes("fb_leads")) return <UpgradeNotice feature="Facebook Lead Ads" />;
  const { error } = await searchParams;
  const ready = hasServiceRole() && Boolean(process.env.LB_SECRETS_KEY);
  const acct = ready ? await fbAccount(profile.company_id).catch(() => null) : null;

  const crumbs = <span className="flex items-center gap-1 font-semibold text-slate-600"><Link href="/admin/quick-setup" aria-label="Quick Setup" className="text-violet-700">⌂</Link><span className="text-violet-700">›</span> FB-Login</span>;
  if (!acct) {
    return (
      <>
        <nav aria-label="Breadcrumb" className="mb-4 text-sm">{crumbs}</nav>
        {error && <div className="mb-4"><ErrorBox message={error} /></div>}
        {!ready && <div className="mb-4"><ErrorBox message="Server setting(s) missing — SUPABASE_SERVICE_ROLE_KEY / LB_SECRETS_KEY." /></div>}
        <section className="card flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-slate-600">Connect the Facebook account that manages your Pages and Lead Ads. New leads will be created in LEAD BOX automatically.</p>
          <a href="/api/facebook/login" className="btn rounded-full bg-[#1877F2] px-5 text-white hover:bg-[#166FE5]">Connect Facebook</a>
          <p className="text-xs text-slate-500">Needs the Meta App ID and App Secret in <Link className="text-brand-700 hover:underline" href="/admin/integrations">Integrations</Link>.</p>
        </section>
      </>
    );
  }

  const db = createAdminClient();
  const [pagesR, adAccR, saved, ads] = await Promise.all([
    graph<{ data: { id: string; name: string }[] }>(acct.token, "me/accounts?fields=id,name&limit=100"),
    graph<{ data: { id: string; name: string; account_id: string }[] }>(acct.token, "me/adaccounts?fields=name,account_id&limit=100"),
    db.from("lb_fb_pages").select("page_id,page_name,is_selected,subscribed").eq("company_id", profile.company_id).order("created_at"),
    db.from("lb_fb_ads").select("ad_id,ad_name,ad_account_name").eq("company_id", profile.company_id).order("created_at"),
  ]);
  const fbError = [!pagesR.ok && `Pages: ${pagesR.message}`, !adAccR.ok && `Ad accounts: ${adAccR.message}`].filter(Boolean).join(" · ");

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm">{crumbs}</nav>
      {(error || fbError) && <div className="mb-4"><ErrorBox message={error || fbError} /></div>}
      <section className="card space-y-5 p-4">
        <FbHeader name={acct.fb_user_name ?? "Facebook"} id={acct.fb_user_id} onlySelected={acct.only_selected} />
        <FbPickers pages={pagesR.ok ? pagesR.data.data : []} adAccounts={adAccR.ok ? adAccR.data.data : []} />
        <SavedPages pages={saved.data ?? []} />
        <SavedAds ads={ads.data ?? []} />
      </section>
    </>
  );
}

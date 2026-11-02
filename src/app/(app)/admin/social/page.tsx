import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/server";
import { PageHeader, ErrorBox } from "@/components/static";
import { fbAccount } from "@/lib/facebook";
import { graph } from "@/lib/whatsapp";
import { SocialPages } from "./ui";

export const metadata = { title: "Instagram & Messenger" };

const NEEDED = ["pages_messaging", "instagram_basic", "instagram_manage_messages"];

export default async function SocialAdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { profile } = await requireAdmin();
  const { error } = await searchParams;
  const header = <PageHeader title="Instagram & Messenger" icon="chat" tone="violet"
    sub="Instagram DMs and Facebook Messenger chats come into the same Inbox as WhatsApp. Reply, assign, add notes and turn a chat into a lead." />;
  const ready = hasServiceRole() && Boolean(process.env.LB_SECRETS_KEY);
  const acct = ready ? await fbAccount(profile.company_id).catch(() => null) : null;
  if (!acct) {
    return (
      <>
        {header}
        {error && <div className="mb-4"><ErrorBox message={error} /></div>}
        <section className="card flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-slate-600">Connect the Facebook account that manages your Page (and the Instagram professional account linked to it).</p>
          <a href="/api/facebook/login?for=social" className="btn rounded-full bg-[#1877F2] px-5 text-white hover:bg-[#166FE5]">Connect Facebook</a>
          <p className="text-xs text-slate-500">Needs the Meta App ID and App Secret in <Link className="text-brand-700 hover:underline" href="/admin/integrations">Integrations</Link>.</p>
        </section>
      </>
    );
  }
  const db = createAdminClient();
  const [pagesR, permsR, saved] = await Promise.all([
    graph<{ data: { id: string; name: string; instagram_business_account?: { id: string; username?: string } }[] }>(acct.token, "me/accounts?fields=id,name,instagram_business_account{id,username}&limit=100"),
    graph<{ data: { permission: string; status: string }[] }>(acct.token, "me/permissions"),
    db.from("lb_fb_pages").select("page_id,messenger_enabled,ig_enabled,ig_username").eq("company_id", profile.company_id),
  ]);
  if (saved.error) return <>{header}<ErrorBox message="Instagram / Messenger inbox is not set up yet: the database update has to be run once (Supabase SQL)." /></>;
  const granted = new Set((permsR.ok ? permsR.data.data : []).filter((p) => p.status === "granted").map((p) => p.permission));
  const missing = NEEDED.filter((p) => !granted.has(p));
  const flags = new Map((saved.data ?? []).map((r) => [r.page_id as string, r]));
  const pages = (pagesR.ok ? pagesR.data.data : []).map((p) => ({
    id: p.id, name: p.name, ig: p.instagram_business_account?.username ?? (p.instagram_business_account ? "Instagram account" : null),
    messenger: Boolean(flags.get(p.id)?.messenger_enabled), instagram: Boolean(flags.get(p.id)?.ig_enabled),
  }));
  return (
    <>
      {header}
      {(error || !pagesR.ok) && <div className="mb-4"><ErrorBox message={error || `Facebook: ${!pagesR.ok ? pagesR.message : ""}`} /></div>}
      {missing.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Messaging permission is not granted yet ({missing.join(", ")}).{" "}
          <a href="/api/facebook/login?for=social" className="font-semibold underline">Grant messaging permission</a>
        </div>
      )}
      <SocialPages pages={pages} />
      <section className="card mt-4 space-y-2 p-4 text-sm text-slate-600">
        <h2 className="font-semibold text-navy-900">One-time Meta app setup</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Meta app → Webhooks: object <b>Page</b> → subscribe <code>messages</code>, <code>messaging_postbacks</code>; object <b>Instagram</b> → subscribe <code>messages</code>. Callback URL is the same as Lead Ads: <code>https://wacrm.leadboxs.in/api/facebook/webhook</code>.</li>
          <li>App Review: request <code>pages_messaging</code>, <code>instagram_basic</code>, <code>instagram_manage_messages</code> (and <b>Human Agent</b> to reply up to 7 days).</li>
          <li>Instagram app → Settings → Privacy → Messages: allow access to messages (connected tools).</li>
        </ol>
      </section>
    </>
  );
}

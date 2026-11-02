import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/static";
import { EmptyState, Notice, Panel } from "@/components/kit";
import { fmtDateTime } from "@/lib/dates";
import { googleConfigured } from "@/lib/google";
import { GmailButtons } from "./forms";

export const metadata = { title: "Email (Gmail)" };

export default async function EmailPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { connected, error } = await searchParams;
  const { profile } = await requireProfile();
  const sb = await createClient();
  const acc = await sb.from("lb_google_accounts").select("id,email,last_sync_at,last_error,is_active").eq("user_id", profile.id).maybeSingle();
  const setup = !acc.error;
  const account = acc.data;
  const { data: mails } = account
    ? await sb.from("lb_emails").select("id,direction,from_email,to_emails,subject,snippet,sent_at,lead_id,customer:lb_customers(name)").eq("user_id", profile.id).order("sent_at", { ascending: false }).limit(30)
    : { data: [] };

  return (
    <>
      <PageHeader icon="inbox" tone="blue" title="Email (Gmail)" sub="Connect your Gmail. Mails with your customers show on their lead, and you can reply from the lead page." />
      {connected && <Notice tone="green">Gmail connected. Customer emails from the last 30 days are being added.</Notice>}
      {error && <Notice tone="red">{error}</Notice>}
      {!setup && <Notice>Email is not set up yet: run the database update (20261102060300_lb_gmail.sql) once in Supabase.</Notice>}
      {setup && !googleConfigured() && <Notice>Gmail is not switched on yet: the Google OAuth Client ID and Secret have to be added on the server (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET).</Notice>}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Panel title="Recent customer emails" icon="inbox">
          {!mails?.length ? <EmptyState icon="inbox" title="No customer emails yet">Only mails to or from an email address saved on a customer are added. Everything else in your Gmail stays private.</EmptyState> : (
            <ul className="divide-y divide-slate-100">
              {mails.map((m) => (
                <li key={m.id} className="py-2 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium text-navy-900">{m.direction === "in" ? "From" : "To"} {(m.customer as unknown as { name: string | null } | null)?.name || (m.direction === "in" ? m.from_email : m.to_emails[0])}</span>
                    <span className="text-xs text-slate-500">{fmtDateTime(m.sent_at)}</span>
                  </div>
                  <div className="text-slate-700">{m.subject || "(no subject)"}</div>
                  <div className="truncate text-xs text-slate-500">{m.snippet}</div>
                  {m.lead_id && <Link href={`/leads/${m.lead_id}`} className="text-xs text-brand-700 hover:underline">Open lead</Link>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Your Gmail" icon="link">
          {account ? (
            <div className="space-y-2 text-sm">
              <div className="font-medium text-navy-900">{account.email}</div>
              <div className="text-xs text-slate-500">Last sync {fmtDateTime(account.last_sync_at)} · syncs every 5 minutes</div>
              {!account.is_active && <p className="text-xs text-red-700">Paused: Google access was removed. Connect again.</p>}
              {account.last_error && <p className="text-xs text-red-700">{account.last_error}</p>}
              <GmailButtons />
              {!account.is_active && <a href="/api/google/login" className="btn-primary btn-sm inline-flex">Connect again</a>}
            </div>
          ) : (
            <div className="space-y-2 text-sm text-slate-600">
              <p>Lead Box reads only mails with your customers and sends mails you write from a lead.</p>
              {setup && googleConfigured() ? <a href="/api/google/login" className="btn-primary inline-flex">Connect Gmail</a> : <p className="text-xs text-slate-500">Available once setup is finished.</p>}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

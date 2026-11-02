import Link from "next/link";
import { requireProfile, isManager, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/dates";
import { CopyField } from "../../admin/integrations/forms";
import { Panel, EmptyState, Notice } from "../ui";
import { CreateGroupForm, GroupActions, SendManyForm } from "./forms";
import { GROUP_MAX_PARTICIPANTS } from "@/lib/wa-groups";

export const metadata = { title: "Groups · WhatsApp" };

const STATE: Record<string, string> = {
  active: "bg-brand-100 text-brand-700", creating: "bg-amber-100 text-amber-800", failed: "bg-red-100 text-red-700",
  suspended: "bg-red-100 text-red-700", deleted: "bg-slate-200 text-slate-600",
};

export default async function GroupsPage() {
  const { profile } = await requireProfile();
  const manage = isManager(profile) && can(profile, "chats.send");
  const sb = await createClient();
  const [groups, { data: numbers }] = await Promise.all([
    sb.from("lb_wa_groups").select("id,subject,status,error,invite_link,participants,last_message_at,created_at,number:lb_wa_numbers(label)")
      .eq("company_id", profile.company_id).neq("status", "deleted").order("created_at", { ascending: false }),
    sb.from("lb_wa_numbers").select("id,label,provider,is_active").eq("company_id", profile.company_id).eq("is_active", true).order("label"),
  ]);
  if (groups.error) return <Notice tone="amber">WhatsApp groups are not set up yet: run the database update (20261102060400_lb_wa_groups.sql) once in Supabase.</Notice>;
  const rows = groups.data ?? [];
  const cloud = (numbers ?? []).filter((n) => n.provider !== "qr").map((n) => ({ id: n.id as string, label: n.label as string }));
  const active = rows.filter((g) => g.status === "active").map((g) => ({ id: g.id as string, subject: g.subject as string }));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Notice tone="amber">
          WhatsApp&apos;s official groups are small: up to <b>{GROUP_MAX_PARTICIPANTS} people</b> per group, and people join only by tapping the <b>invite link</b> (you cannot add them yourself).
          The number needs an <b>Official Business Account</b> (green tick). Communities and big groups are not available in Meta&apos;s API. For messaging many customers at once use <Link href="/whatsapp/broadcast" className="font-medium underline">Broadcast</Link>.
        </Notice>
        <Panel title={`Groups (${rows.length})`} icon="contacts">
          {!rows.length ? (
            <EmptyState icon="contacts" title="No groups yet">Create one on the right, then share its invite link with your customer or dealer.</EmptyState>
          ) : (
            <div className="space-y-3">
              {rows.map((g) => (
                <div key={g.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/whatsapp/groups/${g.id}`} className="font-semibold text-navy-900 hover:text-brand-700">{g.subject}</Link>
                        <span className={`badge ${STATE[g.status] ?? ""}`}>{g.status}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {(g.number as unknown as { label: string } | null)?.label ?? "—"} · {g.participants}/{GROUP_MAX_PARTICIPANTS} people · last message {fmtDateTime(g.last_message_at)}
                      </div>
                      {g.error && <div className="mt-1 text-sm text-red-700">{g.error}</div>}
                    </div>
                    {manage && <GroupActions id={g.id} link={g.invite_link} />}
                  </div>
                  {g.invite_link && <div className="mt-2"><CopyField label="Invite link" value={g.invite_link} /></div>}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
      <div className="space-y-4">
        {manage ? (
          <>
            <Panel title="Create a group" icon="plus"><CreateGroupForm numbers={cloud} /></Panel>
            {active.length > 0 && <Panel title="Message several groups" icon="megaphone"><SendManyForm groups={active} /></Panel>}
          </>
        ) : <Notice tone="amber">Only admins and team leaders can create groups and send to them.</Notice>}
        <Panel title="Setup once" icon="gear">
          <ol className="list-decimal space-y-1 pl-4 text-sm text-slate-600">
            <li>Meta App → WhatsApp → Configuration → Webhook fields: tick <b>group_lifecycle_update</b>, <b>group_participants_update</b>, <b>group_settings_update</b>, <b>group_status_update</b>.</li>
            <li>Create the group here, copy the invite link and send it (chat, SMS, email).</li>
            <li>Messages people write in the group show on the group page. They never create leads.</li>
          </ol>
        </Panel>
      </div>
    </div>
  );
}

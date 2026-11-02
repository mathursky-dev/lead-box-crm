import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile, isManager, can } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/dates";
import { CopyField } from "../../../admin/integrations/forms";
import { Panel, EmptyState, Notice } from "../../ui";
import { GroupActions, InviteForm, RemoveMember, SendToGroupForm } from "../forms";
import { GROUP_MAX_PARTICIPANTS, participants } from "@/lib/wa-groups";

export const metadata = { title: "Group · WhatsApp" };

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { profile } = await requireProfile();
  const manage = isManager(profile) && can(profile, "chats.send");
  const sb = await createClient();
  const { data: g } = await sb.from("lb_wa_groups").select("id,subject,description,status,error,invite_link,participants,wa_group_id,created_at,number:lb_wa_numbers(label)")
    .eq("id", id).eq("company_id", profile.company_id).maybeSingle();
  if (!g) notFound();
  const [{ data: msgs }, members] = await Promise.all([
    sb.from("lb_wa_group_messages").select("id,direction,from_wa,from_name,type,body,media_url,status,error,created_at").eq("group_id", id).order("created_at", { ascending: false }).limit(100),
    g.status === "active" ? participants(createAdminClient(), id).catch(() => [] as string[]) : Promise.resolve([] as string[]),
  ]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Link href="/whatsapp/groups" className="text-sm text-brand-700 hover:underline">← All groups</Link>
        <Panel title={g.subject} icon="contacts" actions={manage ? <GroupActions id={g.id} link={g.invite_link} /> : undefined}
          sub={`${(g.number as unknown as { label: string } | null)?.label ?? ""} · ${g.status} · ${g.participants}/${GROUP_MAX_PARTICIPANTS} people`}>
          {g.description && <p className="mb-3 whitespace-pre-wrap text-sm text-slate-600">{g.description}</p>}
          {g.error && <Notice tone="red">{g.error}</Notice>}
          {g.invite_link ? <CopyField label="Invite link (share it; people join by tapping it)" value={g.invite_link} />
            : <p className="text-sm text-slate-500">No invite link yet. Tap Refresh in a few seconds.</p>}
        </Panel>
        <Panel title="Messages" icon="chat">
          {!msgs?.length ? <EmptyState icon="chat" title="No messages yet">Send the first update from the right.</EmptyState> : (
            <ul className="space-y-2">
              {msgs.map((m) => (
                <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.direction === "out" ? "ml-auto bg-brand-50" : "bg-slate-100"}`}>
                  <div className="text-[11px] text-slate-500">{m.direction === "out" ? "You" : m.from_name || `+${m.from_wa}`} · {fmtDateTime(m.created_at)}{m.direction === "out" && ` · ${m.status}`}</div>
                  {m.body && <div className="whitespace-pre-wrap text-navy-900">{m.body}</div>}
                  {m.media_url && <a href={m.media_url} target="_blank" rel="noreferrer" className="text-xs text-brand-700 underline">{m.type} file</a>}
                  {!m.body && !m.media_url && <div className="text-slate-500">[{m.type}]</div>}
                  {m.error && <div className="text-xs text-red-700">{m.error}</div>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <div className="space-y-4">
        {manage && g.status === "active" && <Panel title="Send to group" icon="send"><SendToGroupForm id={g.id} /></Panel>}
        {manage && g.invite_link && (
          <Panel title="Invite a customer" icon="plus" sub="Sends the link in their existing chat (needs a message from them in the last 24 hours).">
            <InviteForm id={g.id} />
          </Panel>
        )}
        <Panel title={`People (${members.length})`} icon="contacts">
          {!members.length ? <p className="text-sm text-slate-500">Nobody has joined yet.</p> : (
            <ul className="divide-y divide-slate-100">
              {members.map((w) => (
                <li key={w} className="flex items-center justify-between py-1.5 text-sm">+{w}{manage && <RemoveMember id={g.id} waId={w} />}</li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

"use client";
import { ActionButton, ActionForm, Field, Submit } from "@/components/ui";
import { createGroupAction, deleteGroupAction, inviteContactAction, refreshGroupAction, removeMemberAction, resetLinkAction, sendGroupMessageAction, sendManyGroupsAction } from "@/lib/actions/wa-groups";

export function CreateGroupForm({ numbers }: { numbers: { id: string; label: string }[] }) {
  if (!numbers.length) return <p className="text-sm text-slate-600">Connect an official Cloud API number first (Connections). QR-scan numbers cannot run groups.</p>;
  return (
    <ActionForm action={createGroupAction} resetOnOk>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Group name"><input className="input" name="subject" required maxLength={128} placeholder="e.g. Sharma Traders × Lead Box" /></Field>
        <Field label="WhatsApp number">
          <select className="input" name="number_id" required defaultValue={numbers[0]?.id}>{numbers.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select>
        </Field>
      </div>
      <Field label="Description (optional)"><textarea className="input" name="description" rows={2} maxLength={2048} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="approval" /> I approve each person before they join</label>
      <Submit pendingText="Creating…">Create group</Submit>
    </ActionForm>
  );
}

export function GroupActions({ id, link }: { id: string; link: string | null }) {
  return (
    <div className="flex flex-wrap gap-1">
      <ActionButton action={() => refreshGroupAction(id)}>Refresh</ActionButton>
      {link && <ActionButton action={() => resetLinkAction(id)} confirm="Make a new invite link? The old link stops working.">New link</ActionButton>}
      <ActionButton action={() => deleteGroupAction(id)} className="btn-ghost btn-sm text-red-600" confirm="Delete this group on WhatsApp? Everyone is removed and it cannot be undone.">Delete</ActionButton>
    </div>
  );
}

export function RemoveMember({ id, waId }: { id: string; waId: string }) {
  return <ActionButton action={() => removeMemberAction(id, waId)} className="btn-ghost btn-sm text-red-600" confirm={`Remove +${waId} from the group?`}>Remove</ActionButton>;
}

export function SendToGroupForm({ id }: { id: string }) {
  return (
    <ActionForm action={sendGroupMessageAction} resetOnOk>
      <input type="hidden" name="group_id" value={id} />
      <textarea className="input" name="text" rows={3} maxLength={4096} placeholder="Message to the group" />
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input className="input" name="media_url" type="url" placeholder="Optional: https:// link to an image, PDF or video" />
        <select className="input" name="media_type" defaultValue="image" aria-label="File type"><option value="image">Image</option><option value="document">PDF / document</option><option value="video">Video</option></select>
      </div>
      <Submit pendingText="Sending…">Send to group</Submit>
    </ActionForm>
  );
}

export function InviteForm({ id }: { id: string }) {
  return (
    <ActionForm action={inviteContactAction} resetOnOk className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="group_id" value={id} />
      <input className="input w-52" name="phone" required placeholder="Customer mobile" inputMode="tel" />
      <Submit className="btn-ghost" pendingText="Sending…">Send invite in chat</Submit>
    </ActionForm>
  );
}

export function SendManyForm({ groups }: { groups: { id: string; subject: string }[] }) {
  return (
    <ActionForm action={sendManyGroupsAction} resetOnOk>
      <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
        {groups.map((g) => (
          <label key={g.id} className="flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs"><input type="checkbox" name="group_ids" value={g.id} /> {g.subject}</label>
        ))}
      </div>
      <textarea className="input" name="text" rows={3} maxLength={4096} required placeholder="Same message to every ticked group" />
      <Submit pendingText="Sending…">Send to ticked groups</Submit>
    </ActionForm>
  );
}
